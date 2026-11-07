//go:build integration

package postgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/jackc/pgx/v5/pgxpool"
)

func migrationWorkerStore(t *testing.T) *Store {
	t.Helper()
	pool, e := pgxpool.New(context.Background(), testEnv.superDSN+"&options=-c%20role%3Dvc_worker")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(pool.Close)
	base := testEnv.store
	return &Store{pool: pool, secret: base.secret, cipher: base.cipher, txTimeout: base.txTimeout}
}
func TestSX8TrustedCheckpointReverseAndActivation(t *testing.T) {
	c := storedChatFixture(t)
	base := testEnv.store
	ctx := context.Background()
	sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "trusted synthetic", "is_user": true}))
	worker := migrationWorkerStore(t)
	run, e := worker.FreezeChatMigration(ctx, 1, chatUUID(), "GO_TO_ST", "GO", 2)
	if e != nil {
		t.Fatal(e)
	}
	var body bytes.Buffer
	archive, e := worker.ReverseExportChatMigration(ctx, 1, run.RunID, c.ChatID, &body)
	if e != nil {
		t.Fatal(e)
	}
	manifest, e := worker.ChatMigrationSupplement(ctx, 1, run.RunID)
	if e != nil {
		t.Fatal(e)
	}
	manifest.Chats[0] = archive
	if e = worker.VerifyChatMigration(ctx, 1, manifest); e != nil {
		t.Fatal(e)
	}
	if _, e = psqlSuper(`UPDATE vc.chat_authority SET authority='ST' WHERE owner_user_id=2`); e != nil {
		t.Fatal(e)
	}
	target, e := worker.FreezeChatMigration(ctx, 2, chatUUID(), "ST_TO_GO", "ST", 2)
	if e != nil {
		t.Fatal(e)
	}
	manifest.OwnerAccountID = 2
	manifest.MigrationRunID = target.RunID
	manifest.Direction = "ST_TO_GO"
	manifest.FrozenAuthorityEpoch = target.FrozenEpoch
	objects := transferTestObjects{}
	intent, e := worker.BeginChatTransfer(ctx, 2)
	if e != nil {
		t.Fatal(e)
	}
	writer := chattransfer.NewWriter(ctx, objects, intent.Prefix, 256<<20)
	if _, e = writer.Write(body.Bytes()); e != nil {
		t.Fatal(e)
	}
	staged, e := writer.Seal()
	if e != nil {
		t.Fatal(e)
	}
	if e = worker.StageChatMigration(ctx, 2, manifest, archive, staged, objects); e != nil {
		t.Fatal(e)
	}
	if e = worker.StageChatMigration(ctx, 2, manifest, archive, staged, objects); e != nil {
		t.Fatalf("checkpoint resume: %v", e)
	}
	bad := archive
	sum := sha256.Sum256([]byte("changed"))
	bad.SourceSHA256 = fmt.Sprintf("%x", sum[:])
	e = worker.StageChatMigration(ctx, 2, manifest, bad, staged, objects)
	expectChatCode(t, e, "IDEMPOTENCY_KEY_REUSED")
	if e = worker.VerifyChatMigration(ctx, 2, manifest); e != nil {
		t.Fatal(e)
	}
	epoch, e := worker.ActivateChatMigration(ctx, 2, target.RunID, target.FrozenEpoch)
	if e != nil || epoch != 4 {
		t.Fatalf("activate %d %v", epoch, e)
	}
	var restored bytes.Buffer
	if _, e = base.CaptureStoredChatJSONL(ctx, 2, c.ChatID, nil, &restored); e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(body.Bytes(), restored.Bytes()) {
		t.Fatal("trusted archive changed complete JSONL")
	}
}

func TestSX8ParentCascadePreservesIdentityTombstone(t *testing.T) {
	for _, kind := range []string{"conversation", "relationship"} {
		t.Run(kind, func(t *testing.T) {
			c := sx7SourceChat(t)
			s := testEnv.store
			ctx := context.Background()
			appended := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "synthetic erased body", "is_user": true, "swipes": []any{"synthetic erased body", "other erased candidate"}, "swipe_id": 0}))
			message := appended.Changed[0]
			var e error
			if kind == "conversation" {
				e = s.DeleteConversation(ctx, 1, *c.ConversationID)
			} else {
				e = s.DeleteRelationship(ctx, 1, *c.RelationshipID, false)
			}
			if e != nil {
				t.Fatal(e)
			}
			var tombstone string
			e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
				return tx.QueryRow(ctx, `SELECT record_json::text FROM vc.chat_identity_tombstone WHERE owner_user_id=1 AND chat_id=$1`, c.ChatID).Scan(&tombstone)
			})
			if e != nil {
				t.Fatal(e)
			}
			if strings.Contains(tombstone, "erased body") || strings.Contains(tombstone, "other erased") {
				t.Fatal("tombstone retained body")
			}
			worker := migrationWorkerStore(t)
			run, e := worker.FreezeChatMigration(ctx, 1, chatUUID(), "GO_TO_ST", "GO", 2)
			if e != nil {
				t.Fatal(e)
			}
			manifest, e := worker.ChatMigrationSupplement(ctx, 1, run.RunID)
			if e != nil {
				t.Fatal(e)
			}
			found := false
			for _, archive := range manifest.Chats {
				if archive.OldIdentity != c.ChatID {
					continue
				}
				found = true
				if archive.State != "deleted" || len(archive.MessageAndCandidateIdentityRecords) != 1 || archive.MessageAndCandidateIdentityRecords[0].MessageID != message.MessageID || len(archive.MessageAndCandidateIdentityRecords[0].Candidates) != 2 {
					t.Fatal("cascade lost identity ledger")
				}
				for _, candidate := range archive.MessageAndCandidateIdentityRecords[0].Candidates {
					if !candidate.Deleted {
						t.Fatal("cascade candidate resurrectable")
					}
				}
			}
			if !found {
				t.Fatal("deleted chat absent from archive")
			}
			if e = worker.VerifyChatMigration(ctx, 1, manifest); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestSX8LegacyInboxAssociationUsesExistingReceipt(t *testing.T) {
	c, event := storedInboxFixture(t)
	s := testEnv.store
	ctx := context.Background()
	claim, e := s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if e != nil {
		t.Fatal(e)
	}
	delivery, e := s.DeliverStoredInbox(ctx, 1, c.ChatID, event.EventID, claim.LeaseToken)
	if e != nil || delivery.Readback == nil {
		t.Fatal(e)
	}
	if _, e = s.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, delivery.Readback.MessageID, delivery.Readback.MessageRevision); e != nil {
		t.Fatal(e)
	}
	worker := migrationWorkerStore(t)
	run, e := worker.FreezeChatMigration(ctx, 1, chatUUID(), "GO_TO_ST", "GO", 2)
	if e != nil {
		t.Fatal(e)
	}
	// Model an already staged raw chat whose prior ST delivery has no Go mapping.
	if e = IsolationSuperExec(ctx, `DELETE FROM vc.stored_chat_inbox WHERE owner_user_id=1; UPDATE vc.chat_migration_run SET direction='ST_TO_GO' WHERE owner_user_id=1`); e != nil {
		t.Fatal(e)
	}
	manifest, e := worker.ChatMigrationSupplement(ctx, 1, run.RunID)
	if e != nil {
		t.Fatal(e)
	}
	rights := []ChatData{}
	for _, right := range manifest.DeletionAndSuppressionRecords {
		if right["type"] == "inbox" {
			rights = append(rights, right)
		}
	}
	if len(rights) != 1 || rights[0]["eventId"] != event.EventID || rights[0]["messageId"] != delivery.Readback.MessageID {
		t.Fatal("legacy delivery omitted from supplement")
	}
	encoded, _ := chatJSON(rights)
	e = worker.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.stage_migration_inbox($1,$2,$3,$4,$5)`, 1, run.RunID, run.FrozenEpoch, c.ChatID, encoded)
		return e
	})
	if e != nil {
		t.Fatal(e)
	}
	if e = IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='GO',epoch=4 WHERE owner_user_id=1`); e != nil {
		t.Fatal(e)
	}
	c.AuthorityEpoch = 4
	claim, e = s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.DeliverStoredInbox(ctx, 1, c.ChatID, event.EventID, claim.LeaseToken)
	if e != nil || again.Saved || again.Readback == nil || again.Readback.MessageID != delivery.Readback.MessageID {
		t.Fatal("legacy receipt redelivered history")
	}
	_, e = s.ApplyStoredChatOperations(ctx, 1, c.ChatID, ChatOperationsRequest{RequestID: chatUUID(), AuthorityEpoch: 4, Operations: []ChatOperation{sx5Operation(t, "delete", ChatData{"messageId": delivery.Readback.MessageID}, ChatData{"messageRevision": "1"}, nil)}})
	if e != nil {
		t.Fatal(e)
	}
	var state string
	e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT link_status FROM vc.inbox_event WHERE owner_user_id=1 AND event_id=$1`, event.EventID).Scan(&state)
	})
	if e != nil || state != "removed" {
		t.Fatal("migrated association missed source invalidation")
	}
}
