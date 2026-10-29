//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestMemoryPlaintextStorageAndLiteralEnvelopePrefixes(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	text := "enc2:这是一段明文；我下周五去厦门参加朋友婚礼。"
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, text, at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	m := addSTMemory(t, b, text, ref)
	// Runtime has no direct memory-table SELECT privilege; inspect physical
	// storage through the synthetic fixture connection without changing grants.
	super, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer super.Close(ctx)
	var source, summary, temporal string
	if err := super.QueryRow(ctx, `SELECT content_cipher FROM vc.st_message_source WHERE owner_user_id=1 AND source_ref=$1`, ref).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if err := super.QueryRow(ctx, `SELECT summary,temporal_cipher FROM vc.memory_item WHERE owner_user_id=1 AND id=$1`, m.ID).Scan(&summary, &temporal); err != nil {
		t.Fatal(err)
	}
	if source != text || summary != text || !json.Valid([]byte(temporal)) {
		t.Fatal("memory/source plaintext or temporal JSON changed at rest")
	}
	decoded, err := testEnv.store.decodeMemoryTime(temporal)
	if err != nil || decoded.EventDate == nil || *decoded.EventDate != "2026-10-30" || !decoded.RecordedAt.Equal(m.Time.RecordedAt) {
		t.Fatal("stored temporal object did not round-trip")
	}
	profileEngineFixture(t, b, ref, text)
	var persona string
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_persona FROM vc.memory_profile_current(1,$1,$2)`, b.RelationshipID, b.ConversationID).Scan(&persona)
	}); err != nil || persona != text {
		t.Fatalf("plaintext profile read: %q err=%v", persona, err)
	}
	var storedPersona string
	if err := super.QueryRow(ctx, `SELECT persona FROM vc.memory_profile WHERE owner_user_id=1 AND relationship_id=$1 AND valid`, b.RelationshipID).Scan(&storedPersona); err != nil || storedPersona != text {
		t.Fatal("memory profile is not stored as plaintext")
	}
	var retired int
	if err := super.QueryRow(ctx, `SELECT count(*) FROM vc.conversation_summary WHERE owner_user_id=1 AND prompt_version='st-memorycore-profile-v1' AND btrim(summary)<>''`).Scan(&retired); err != nil || retired != 0 {
		t.Fatalf("retired engine profile still stored in conversation_summary: n=%d err=%v", retired, err)
	}
	updated := "enc1:这是新的明文偏好"
	if m, err = testEnv.store.UpdateMemory(ctx, 1, m.ID, updated, nil, nil, nil); err != nil || m.Summary != updated {
		t.Fatalf("literal prefix update failed: %v", err)
	}
	listed, err := testEnv.store.ListMemories(ctx, 1, b.RelationshipID, false)
	if err != nil || len(listed) != 1 || listed[0].Summary != updated {
		t.Fatalf("literal prefix list failed: %v", err)
	}
	matches, err := testEnv.store.searchEngineMemories(ctx, 1, b.RelationshipID, b.ConversationID, recallQuery{Text: "新的明文偏好"})
	if err != nil || len(matches) != 1 || matches[0].Summary != updated {
		t.Fatalf("literal prefix recall failed: %v", err)
	}
	testEnv.store.UseSTDataClient(&testSTData{})
	t.Cleanup(func() { testEnv.store.UseSTDataClient(nil) })
	installRightsEngine(t, testEnv.store)
	exported, err := testEnv.store.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	sources := exported.Go["sources"].([]any)
	if len(sources) != 1 || sources[0].(map[string]any)["content"] != text {
		t.Fatal("export interpreted a literal source prefix as ciphertext")
	}
}

func TestOpenRequiresMemoryPlaintextMigration(t *testing.T) {
	ctx := context.Background()
	// The synthetic database retains all schema objects, but removing the
	// version marker models an incomplete or rolled-back data conversion.
	if err := IsolationSuperExec(ctx, `DELETE FROM public.vc_schema_history WHERE version=146`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := IsolationSuperExec(ctx, `INSERT INTO public.vc_schema_history(version,name,execution_ms) VALUES(146,'V146__memory_plaintext.sql',0)`); err != nil {
			t.Error(err)
		}
	})
	store, err := Open(ctx, OpenConfig{DSN: testEnv.runtimeDSN, OwnerBindingSecret: testOwnerBindingSecret})
	if store != nil {
		store.Close()
	}
	if err == nil {
		t.Fatal("runtime opened before memory plaintext migration completed")
	}
}
