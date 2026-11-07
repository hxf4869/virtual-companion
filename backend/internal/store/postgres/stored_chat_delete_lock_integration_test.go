//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestStoredChatSX7FDeletionLocksOwnerBeforeParent(t *testing.T) {
	for _, tc := range []struct {
		name         string
		call         string
		parentProbe  string
		relationship bool
		keepRelation bool
	}{
		{"conversation", "SELECT vc.delete_conversation(1,$1)", "SELECT 1 FROM vc.conversation WHERE owner_user_id=1 AND id=$1 FOR KEY SHARE NOWAIT", false, true},
		{"relationship", "SELECT vc.delete_relationship(1,$1,false)", "SELECT 1 FROM vc.relationship WHERE owner_user_id=1 AND id=$1 FOR KEY SHARE NOWAIT", true, false},
		{"reset", "SELECT vc.reset_relationship(1,$1,false)", "SELECT 1 FROM vc.conversation WHERE owner_user_id=1 AND id=$1 FOR KEY SHARE NOWAIT", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			chat := sx7SourceChat(t)
			request := sx5AppendRequest(chat, ChatData{"mes": "synthetic deletion fixture", "is_user": true})
			sx5Append(t, chat, request)

			s := testEnv.store
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			a, err := pgx.Connect(ctx, testEnv.superDSN)
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close(context.Background())
			txA, err := a.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer txA.Rollback(context.Background())
			if err = s.bindOwner(ctx, txA, 1); err != nil {
				t.Fatal(err)
			}
			var locked int
			if err = txA.QueryRow(ctx, `SELECT count(*) FROM vc.lock_stored_chat(1,$1,true)`, chat.ChatID).Scan(&locked); err != nil || locked != 1 {
				t.Fatalf("lock raw chat: rows=%d err=%v", locked, err)
			}
			var hasBody bool
			if err = txA.QueryRow(ctx, `SELECT result_cipher IS NOT NULL FROM vc.chat_receipt WHERE owner_user_id=1 AND request_id=$1`, request.RequestID).Scan(&hasBody); err != nil || !hasBody {
				t.Fatalf("append receipt fixture has no body: %v", err)
			}

			b, err := pgx.Connect(ctx, testEnv.runtimeDSN)
			if err != nil {
				t.Fatal(err)
			}
			defer b.Close(context.Background())
			txB, err := b.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer txB.Rollback(context.Background())
			if err = s.bindOwner(ctx, txB, 1); err != nil {
				t.Fatal(err)
			}
			targetID, parentID := *chat.ConversationID, *chat.ConversationID
			if tc.relationship {
				targetID = *chat.RelationshipID
			}
			if !tc.keepRelation {
				parentID = *chat.RelationshipID
			}
			aPID, bPID := a.PgConn().PID(), b.PgConn().PID()
			done := make(chan struct{})
			var deleted bool
			var deleteErr error
			go func() {
				defer close(done)
				deleteErr = txB.QueryRow(ctx, tc.call, targetID).Scan(&deleted)
				if deleteErr == nil {
					deleteErr = txB.Commit(ctx)
				}
			}()
			defer func() {
				cancel()
				<-done
			}()

			tick := time.NewTicker(10 * time.Millisecond)
			defer tick.Stop()
			for {
				var blockedByA bool
				if err = txA.QueryRow(ctx, `SELECT $1::integer=ANY(pg_blocking_pids($2))`, aPID, bPID).Scan(&blockedByA); err != nil {
					t.Fatal(err)
				}
				if blockedByA {
					break
				}
				select {
				case <-done:
					t.Fatalf("deletion finished before waiting on raw writer: deleted=%t err=%v", deleted, deleteErr)
				case <-ctx.Done():
					t.Fatal("deletion did not wait on raw writer")
				case <-tick.C:
				}
			}

			// The raw writer can still acquire a parent's FK lock while the
			// deletion waits. 55P03 exposes the inverse parent -> raw lock order.
			var parent int
			if err = txA.QueryRow(ctx, tc.parentProbe, parentID).Scan(&parent); err != nil {
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != "55P03" {
					t.Fatalf("probe parent key-share lock: %v", err)
				}
				t.Error("deletion held a parent lock before the stored-chat owner lock (55P03)")
			}
			if err = txA.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			<-done
			if deleteErr != nil || !deleted {
				t.Fatalf("deletion after writer release: deleted=%t err=%v", deleted, deleteErr)
			}

			var relationExists, conversationExists, rawExists, messageExists, candidateExists, changeExists, receiptErased bool
			err = a.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM vc.relationship WHERE owner_user_id=1 AND id=$1),
       EXISTS(SELECT 1 FROM vc.conversation WHERE owner_user_id=1 AND id=$2),
       EXISTS(SELECT 1 FROM vc.stored_chat WHERE owner_user_id=1 AND chat_id=$3),
       EXISTS(SELECT 1 FROM vc.stored_message WHERE owner_user_id=1 AND chat_id=$3),
       EXISTS(SELECT 1 FROM vc.stored_candidate WHERE owner_user_id=1 AND chat_id=$3),
       EXISTS(SELECT 1 FROM vc.chat_change WHERE owner_user_id=1 AND chat_id=$3),
       COALESCE((SELECT result_cipher IS NULL FROM vc.chat_receipt WHERE owner_user_id=1 AND request_id=$4),false)`,
				*chat.RelationshipID, *chat.ConversationID, chat.ChatID, request.RequestID).
				Scan(&relationExists, &conversationExists, &rawExists, &messageExists, &candidateExists, &changeExists, &receiptErased)
			if err != nil {
				t.Fatal(err)
			}
			if relationExists != tc.keepRelation || conversationExists || rawExists || messageExists || candidateExists || changeExists || !receiptErased {
				t.Fatalf("cascade: relationship=%t conversation=%t raw=%t message=%t candidate=%t change=%t receipt_erased=%t",
					relationExists, conversationExists, rawExists, messageExists, candidateExists, changeExists, receiptErased)
			}
		})
	}
}
