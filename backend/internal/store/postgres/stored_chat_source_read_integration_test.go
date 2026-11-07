//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func sx7SourceReadExec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if err := IsolationSuperExec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func sx7SourceReadFixture(t *testing.T) {
	t.Helper()
	resetFixtures(t)
	sx7SourceReadExec(t, `INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name)
		VALUES (1,'sx7-source-owner','fixture','USER','ACTIVE','synthetic'),
		       (2,'sx7-source-other','fixture','USER','ACTIVE','synthetic')
		ON CONFLICT(id) DO UPDATE SET status='ACTIVE'`)
	t.Cleanup(func() { testEnv.store.UseSTSourceReader(nil) })
}

func sx7SourceReadBind(t *testing.T, owner int64) string {
	t.Helper()
	id := chatUUID()
	_, err := testEnv.store.ResolveSTBinding(context.Background(), owner, STBindingInput{
		ChatIdentity: id, CharacterRef: "synthetic-sx7-source", Mode: "COMPANION",
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func sx7SourceReadRaw(t *testing.T, id string, revision int64, deleted bool) {
	t.Helper()
	sx7SourceReadExec(t, `INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,conversation_id,relationship_id,
		character_ref,branch_root,header_cipher,metadata_cipher,revision,deleted_at)
		SELECT c.owner_user_id,c.st_chat_identity::uuid,'SINGLE',c.id,c.relationship_id,
		       'synthetic-sx7-source',c.st_chat_identity::uuid,'enc2:fixture','enc2:fixture',$2,
		       CASE WHEN $3::boolean THEN now() END
		  FROM vc.conversation c WHERE c.owner_user_id=1 AND c.st_chat_identity=$1`, id, revision, deleted)
}

func sx7SourceReadSeed(t *testing.T, id, state string, revision int64) {
	t.Helper()
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		var applied string
		var messages any
		if state == "PRESENT" {
			messages = "[]"
		}
		err := tx.QueryRow(ctx, `SELECT vc.apply_st_source_snapshot(1,$1,NULL,$2,$3,'synthetic',$4::jsonb,NULL)`,
			id, revision, state, messages).Scan(&applied)
		if err == nil && applied != state {
			t.Errorf("seed applied %s, want %s", applied, state)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestStoredChatSX7SourceReadGo(t *testing.T) {
	sx7SourceReadFixture(t)
	ctx := context.Background()
	s := testEnv.store
	present, unknown, stale := sx7SourceReadBind(t, 1), sx7SourceReadBind(t, 1), sx7SourceReadBind(t, 1)
	missing, deleted := sx7SourceReadBind(t, 1), sx7SourceReadBind(t, 1)
	missingDeleted := sx7SourceReadBind(t, 1)
	foreign := sx7SourceReadBind(t, 2)
	if _, err := s.UpdateIncognitoPref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	cleared := sx7SourceReadBind(t, 1)
	sx7SourceReadRaw(t, present, 7, false)
	sx7SourceReadRaw(t, unknown, 7, false)
	sx7SourceReadRaw(t, stale, 8, false)
	sx7SourceReadRaw(t, deleted, 8, true)
	for _, id := range []string{present, stale, missing} {
		sx7SourceReadSeed(t, id, "PRESENT", 7)
	}
	sx7SourceReadSeed(t, missingDeleted, "DELETED", 8)
	sx7SourceReadSeed(t, cleared, "DELETED", 8)
	sx7SourceReadExec(t, `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2)`)

	reads := 0
	s.UseSTSourceReader(sourceReaderFunc(func(context.Context, int64, []stsource.Query) ([]stsource.Snapshot, error) {
		reads++
		return nil, stsource.ErrUnavailable
	}))
	chats := []string{missing, present, deleted, unknown, stale, cleared, missingDeleted}
	states, err := s.ReconcileSTSources(ctx, 1, chats)
	if err != nil || len(states) != len(chats) {
		t.Fatalf("source states count=%d err=%v", len(states), err)
	}
	wantStates := []string{"UNAVAILABLE", "PRESENT", "DELETED", "UNAVAILABLE", "UNAVAILABLE", "DELETED", "UNAVAILABLE"}
	wantRevisions := []int64{0, 7, 8, 0, 0, 8, 0}
	for i, state := range states {
		revision := int64(0)
		if state.Revision != nil {
			revision = *state.Revision
		}
		if state.ChatIdentity != chats[i] || state.State != wantStates[i] || revision != wantRevisions[i] {
			t.Errorf("state %d: got %s revision=%d, want %s revision=%d in request order", i, state.State, revision, wantStates[i], wantRevisions[i])
		}
	}
	for _, id := range []string{foreign, chatUUID()} {
		if _, err := s.ReconcileSTSources(ctx, 1, []string{present, id}); !errors.Is(err, ErrNotFound) {
			t.Errorf("unbound reconcile error=%v, want ErrNotFound", err)
		}
	}
	if reads != 0 {
		t.Fatalf("GO issued %d ST reads", reads)
	}
}

func TestStoredChatSX7SourceReadFailsClosed(t *testing.T) {
	sx7SourceReadFixture(t)
	s := testEnv.store
	id := sx7SourceReadBind(t, 1)
	sx7SourceReadExec(t, `UPDATE vc.identity_account SET status='DISABLED' WHERE id=1`)
	s.UseSTSourceReader(sourceReaderFunc(func(context.Context, int64, []stsource.Query) ([]stsource.Snapshot, error) {
		t.Fatal("failed authority check contacted ST")
		return nil, nil
	}))
	if _, err := s.ReconcileSTSources(context.Background(), 1, []string{id}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("disabled owner error=%v, want ErrNotFound", err)
	}
}

func TestStoredChatSX7SourceReadFencesLateSTSnapshot(t *testing.T) {
	for _, mode := range []string{"FROZEN", "GO", "ST"} {
		t.Run(mode, func(t *testing.T) {
			binding, snapshot, _ := sourceFixture(t)
			ctx := context.Background()
			s := testEnv.store
			if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
				t.Fatal(err)
			}
			if mode == "GO" {
				sx7SourceReadRaw(t, sourceChat, 1, false)
			}
			before := currentSourceRef(t)
			reads := 0
			s.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, _ int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
				reads++
				if reads == 1 {
					sx7SourceReadExec(t, `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'FROZEN',2)`)
					if mode != "FROZEN" {
						sx7SourceReadExec(t, `UPDATE vc.chat_authority SET authority=$1,epoch=3 WHERE owner_user_id=1`, mode)
					}
					late := *snapshot
					late.Revision = 2
					late.Messages = append([]stsource.Message(nil), snapshot.Messages...)
					late.Messages[0].Revision = 2
					return []stsource.Snapshot{late}, nil
				}
				if queries[0].Revision == nil || *queries[0].Revision != 1 {
					t.Fatal("retry observed a stale snapshot already applied")
				}
				return []stsource.Snapshot{{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: snapshot.Location, NotModified: true}}, nil
			}))
			got, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat})
			if err != nil || len(got) != 1 {
				t.Fatalf("source states count=%d err=%v", len(got), err)
			}
			wantState, wantReads := "PRESENT", 1
			switch mode {
			case "FROZEN":
				wantState = "UNAVAILABLE"
			case "ST":
				wantReads = 2
			}
			if got[0].State != wantState || reads != wantReads {
				t.Errorf("state=%s reads=%d, want %s reads=%d", got[0].State, reads, wantState, wantReads)
			}
			if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
				var state string
				var revision int64
				if err := tx.QueryRow(ctx, `SELECT st_source_state,st_applied_revision FROM vc.conversation
					WHERE owner_user_id=1 AND id=$1`, binding.ConversationID).Scan(&state, &revision); err != nil {
					return err
				}
				if state != "PRESENT" || revision != 1 {
					t.Errorf("projection changed to %s revision=%d", state, revision)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if currentSourceRef(t) != before {
				t.Error("late ST snapshot rewrote the source ref")
			}
		})
	}
}
