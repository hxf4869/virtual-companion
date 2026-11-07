//go:build integration

package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestSX8ExportSnapshotAndDeliveryFences(t *testing.T) {
	chat := storedChatFixture(t)
	seedStoredHistory(t, chat, 3)
	s := testEnv.store
	ctx := context.Background()
	chat.Header["extension"] = json.Number("900719925474099312345")
	chat.MessageCount = 3
	chat.Metadata["variables"] = ChatData{"large": json.Number("900719925474099312345")}
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return s.persistStoredChat(ctx, tx, 1, chat, 3, false, false, false)
	}); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	snapshot, err := s.CaptureStoredChatJSONL(ctx, 1, chat.ChatID, &chat.Revision, &body)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ChatID != chat.ChatID || snapshot.Revision != chat.Revision || snapshot.AuthorityEpoch != 2 || snapshot.Bytes != int64(body.Len()) {
		t.Fatal("incorrect snapshot receipt")
	}
	messages := 0
	result, err := chatjsonl.Read(bytes.NewReader(body.Bytes()), chatjsonl.Handlers{OnHeader: func(header chatjsonl.Object) error {
		metadata := asChatData(header["chat_metadata"])
		if header["extension"] != json.Number("900719925474099312345") || asChatData(metadata["variables"])["large"] != json.Number("900719925474099312345") {
			t.Fatal("lost header metadata or exact number")
		}
		if asChatData(metadata["vc_f2"])["id"] != chat.ChatID || metadata["vc_branch_root"] != chat.BranchRoot {
			t.Fatal("missing protected identity")
		}
		return nil
	}, OnMessage: func(line int, m chatjsonl.Object) error {
		messages++
		if messages == 3 {
			swipes := m["swipes"].([]any)
			if len(swipes) != 2 || swipes[1] != "unselected archive marker" {
				t.Fatal("lost unselected candidate")
			}
			if m["variables"] == nil || asChatData(m["unknown"])["kept"] != true {
				t.Fatal("lost full message extension")
			}
		}
		return nil
	}})
	if err != nil || !result.Valid() || messages != 3 {
		t.Fatalf("invalid JSONL: %v %+v", err, result)
	}
	called := false
	err = s.DeliverStoredChatSnapshot(ctx, 1, snapshot, func(ctx context.Context) error { called = true; return nil })
	if err != nil || !called {
		t.Fatalf("delivery: %v", err)
	}
	var foreign bytes.Buffer
	_, err = s.CaptureStoredChatJSONL(ctx, 2, chat.ChatID, nil, &foreign)
	if !errors.Is(err, ErrNotFound) || foreign.Len() != 0 {
		t.Fatal("foreign capture disclosed data")
	}
	stale := chat.Revision + 1
	_, err = s.CaptureStoredChatJSONL(ctx, 1, chat.ChatID, &stale, io.Discard)
	expectChatCode(t, err, "REVISION_CONFLICT")
	// A concurrent edit after capture must prevent the callback, even without a
	// revision parameter on the original capture.
	_, err = s.EditStoredChatMetadata(ctx, 1, chat.ChatID, ChatMetadataEditRequest{RequestID: chatUUID(), AuthorityEpoch: 2, BaseRevision: 1, Changes: []ChatFieldChange{{Path: []string{"metadata", "synthetic"}, After: ChatFieldValue{Exists: true, Value: true}}}})
	if err != nil {
		t.Fatal(err)
	}
	called = false
	err = s.DeliverStoredChatSnapshot(ctx, 1, snapshot, func(context.Context) error { called = true; return nil })
	expectChatCode(t, err, "REVISION_CONFLICT")
	if called {
		t.Fatal("stale snapshot sent")
	}
}

func TestSX8ExportDeliveryHoldsRightsBarriers(t *testing.T) {
	chat := storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	snapshot, err := s.CaptureStoredChatJSONL(ctx, 1, chat.ChatID, nil, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	err = s.DeliverStoredChatSnapshot(ctx, 1, snapshot, func(ctx context.Context) error {
		conn, err := pgx.Connect(ctx, testEnv.superDSN)
		if err != nil {
			return err
		}
		defer conn.Close(ctx)
		// Owner and chat barriers must remain held while the staged bytes are sent.
		for _, query := range []struct {
			sql  string
			args []any
		}{
			{sql: `SELECT id FROM vc.vc_user WHERE id=1 FOR NO KEY UPDATE NOWAIT`},
			{sql: `SELECT chat_id FROM vc.stored_chat WHERE chat_id=$1 FOR UPDATE NOWAIT`, args: []any{chat.ChatID}},
		} {
			_, e := conn.Exec(ctx, query.sql, query.args...)
			var pgErr *pgconn.PgError
			if !errors.As(e, &pgErr) || pgErr.Code != "55P03" {
				t.Fatalf("delivery barrier absent: %v", e)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = psqlSuper(`UPDATE vc.chat_authority SET authority='FROZEN',epoch=epoch+1 WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	err = s.DeliverStoredChatSnapshot(ctx, 1, snapshot, func(context.Context) error { t.Fatal("changed epoch sent"); return nil })
	expectChatCode(t, err, "REVISION_CONFLICT")
}

func TestSX8TransferDedicatedBudgetAndRollback(t *testing.T) {
	chat := storedChatFixture(t)
	ctx := context.Background()
	base := testEnv.store
	s := &Store{pool: base.pool, secret: base.secret, cipher: base.cipher, txTimeout: 20 * time.Millisecond}
	err := s.withChatTransfer(ctx, 1, pgx.TxOptions{IsoLevel: pgx.RepeatableRead}, func(ctx context.Context, tx pgx.Tx) error {
		var statement, lock, isolation, owner string
		if err := tx.QueryRow(ctx, `SELECT current_setting('statement_timeout'),current_setting('lock_timeout'),current_setting('transaction_isolation'),vc.current_owner_id()::text`).Scan(&statement, &lock, &isolation, &owner); err != nil {
			return err
		}
		if statement != "2min" || lock != "5s" || isolation != "repeatable read" || owner != "1" {
			t.Fatalf("incorrect transfer session settings: %s %s %s %s", statement, lock, isolation, owner)
		}
		_, err := tx.Exec(ctx, `SELECT pg_sleep(0.05)`)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT pg_sleep(0.05)`)
		return err
	})
	if err == nil {
		t.Fatal("ordinary transaction budget changed")
	}
	failctx, cancel := context.WithTimeout(ctx, 80*time.Millisecond)
	defer cancel()
	err = s.withChatTransfer(failctx, 1, pgx.TxOptions{}, func(ctx context.Context, tx pgx.Tx) error {
		current, err := s.lockChatExport(ctx, tx, 1, chat.ChatID, 0)
		if err != nil {
			return err
		}
		current.Title = "synthetic rolled back"
		if err = s.persistStoredChat(ctx, tx, 1, current, 0, false, false, false); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT pg_sleep(1)`)
		return err
	})
	expectChatCode(t, err, "CHAT_TRANSFER_TIMEOUT")
	current, err := base.GetStoredChat(ctx, 1, chat.ChatID)
	if err != nil || current.Title != chat.Title {
		t.Fatalf("timeout failed rollback: %v", err)
	}
}
