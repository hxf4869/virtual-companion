//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/turn"
	"github.com/jackc/pgx/v5"
)

// seedFinishedTurn inserts one synthetic finished turn (user message, assistant
// message, generation row) with contents stored through the store cipher and
// returns their ids. status mirrors vc.generation.status; sourceNoMemory /
// assistantNoMemory set the per-message V44 suppression flags.
func seedFinishedTurn(t *testing.T, owner, conv int64, status string, sourceNoMemory, assistantNoMemory bool) (genID, sourceMsgID, assistantMsgID int64) {
	gen, src, asst, _, _ := seedFinishedTurnStored(t, owner, conv, status, sourceNoMemory, assistantNoMemory)
	return gen, src, asst
}

func seedFinishedTurnStored(t *testing.T, owner, conv int64, status string, sourceNoMemory, assistantNoMemory bool) (genID, sourceMsgID, assistantMsgID int64, storedUser, storedAssistant string) {
	t.Helper()
	ctx := context.Background()
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseCipher(ciph)

	genRaw, err := psqlSuper(`SELECT nextval('vc.generation_id_seq')`)
	if err != nil {
		t.Fatal(err)
	}
	genID, err = strconv.ParseInt(genRaw, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	stored := [2]string{}
	msgIDs := [2]int64{}
	for i, spec := range []struct {
		role     string
		content  string
		noMemory bool
	}{
		{role: "user", content: "extract-user-turn", noMemory: sourceNoMemory},
		{role: "assistant", content: "extract-assistant-turn", noMemory: assistantNoMemory},
	} {
		storedText, err := testEnv.store.encryptStored(spec.content)
		if err != nil {
			t.Fatal(err)
		}
		if err := IsolationSuperExec(ctx,
			`INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, no_memory)
			 VALUES ($1, nextval('vc.message_id_seq'), $2, $3, $4, $5)`,
			owner, conv, spec.role, storedText, spec.noMemory); err != nil {
			t.Fatal(err)
		}
		raw, err := psqlSuper(fmt.Sprintf(
			`SELECT max(id) FROM vc.message WHERE owner_user_id = %d AND conversation_id = %d`, owner, conv))
		if err != nil {
			t.Fatal(err)
		}
		msgIDs[i], err = strconv.ParseInt(raw, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		stored[i] = storedText
	}
	if err := IsolationSuperExec(ctx,
		`INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status, source_user_message_id, assistant_message_id, selected)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
		owner, genID, conv, fmt.Sprintf("extract-%d", genID), status, msgIDs[0], msgIDs[1]); err != nil {
		t.Fatal(err)
	}
	return genID, msgIDs[0], msgIDs[1], stored[0], stored[1]
}

func TestEnqueueMemoryExtractCreatesIdempotentJob(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	genID, _, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)

	job1, err := store.EnqueueMemoryExtract(ctx, 1, genID)
	if err != nil || job1 <= 0 {
		t.Fatalf("enqueue job=%d err=%v", job1, err)
	}
	// At-most-one: a repeated enqueue (crash/retry) returns the same job.
	job2, err := store.EnqueueMemoryExtract(ctx, 1, genID)
	if err != nil || job2 != job1 {
		t.Fatalf("re-enqueue job=%d want %d err=%v", job2, job1, err)
	}
	// Another owner cannot enqueue against a foreign generation.
	if _, err := store.EnqueueMemoryExtract(ctx, 2, genID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner enqueue err=%v want ErrNotFound", err)
	}
}

func TestEnqueueMemoryExtractSuppressesNormalOutcomes(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, false); err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	// Pref off is a normal outcome per the store doc comment ("returns 0 with
	// no error"): the SQL NULL from the suppression path scans as job 0.
	genPref, _, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	if job, err := store.EnqueueMemoryExtract(ctx, 1, genPref); err != nil || job != 0 {
		t.Fatalf("pref-off enqueue job=%d err=%v want 0,nil", job, err)
	}
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	// no_memory on the source message suppresses the same way.
	genNoMem, _, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", true, false)
	if job, err := store.EnqueueMemoryExtract(ctx, 1, genNoMem); err != nil || job != 0 {
		t.Fatalf("no_memory enqueue job=%d err=%v want 0,nil", job, err)
	}
	// Incognito conversation suppresses the same way.
	incog, err := store.CreateConversation(ctx, 1, 10, true)
	if err != nil {
		t.Fatal(err)
	}
	genIncog, _, _ := seedFinishedTurn(t, 1, incog, "COMPLETED", false, false)
	if job, err := store.EnqueueMemoryExtract(ctx, 1, genIncog); err != nil || job != 0 {
		t.Fatalf("incognito enqueue job=%d err=%v want 0,nil", job, err)
	}
	// Non-COMPLETED turns are not extraction sources.
	genFailed, _, _ := seedFinishedTurn(t, 1, conv, "FAILED", false, false)
	if job, err := store.EnqueueMemoryExtract(ctx, 1, genFailed); err != nil || job != 0 {
		t.Fatalf("failed enqueue job=%d err=%v want 0,nil", job, err)
	}
	// Whatever the suppression surface, no job row may exist for any of them.
	var jobs int
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT count(*) FROM vc.work_item WHERE kind = 'MEMORY_EXTRACT'`).Scan(&jobs)
	}); err != nil {
		t.Fatal(err)
	}
	if jobs != 0 {
		t.Fatalf("suppressed turns created %d jobs", jobs)
	}
}

func TestReadMemoryExtractInputRoundtrip(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	genID, srcID, asstID, _, _ := seedFinishedTurnStored(t, 1, conv, "COMPLETED", true, false)

	in, err := store.ReadMemoryExtractInput(ctx, 1, genID)
	if err != nil {
		t.Fatal(err)
	}
	if in.RelationshipID != 10 || in.ConversationID != conv || in.Status != "COMPLETED" {
		t.Fatalf("extract input ids %+v", in)
	}
	if in.SourceMessageID == nil || *in.SourceMessageID != srcID {
		t.Fatalf("source message id %+v want %d", in.SourceMessageID, srcID)
	}
	if in.AssistantMessageID == nil || *in.AssistantMessageID != asstID {
		t.Fatalf("assistant message id %+v want %d", in.AssistantMessageID, asstID)
	}
	if in.Incognito || !in.UserNoMemory || in.AssistantNoMemory {
		t.Fatalf("extract flags %+v", in)
	}
	// Content is decrypted on read, matching the store-wide decrypt-on-read
	// convention (ListMessages etc.): the cipher-seeded rows must come back as
	// plaintext because jobs/memory_extract.go feeds these strings into the
	// provider prompt.
	if in.UserContent != "extract-user-turn" || in.AssistantContent != "extract-assistant-turn" {
		t.Fatalf("extract contents %q %q want decrypted plaintext", in.UserContent, in.AssistantContent)
	}

	// Incognito surfaces as a flag, not an error.
	incog, err := store.CreateConversation(ctx, 1, 10, true)
	if err != nil {
		t.Fatal(err)
	}
	genIncog, _, _ := seedFinishedTurn(t, 1, incog, "COMPLETED", false, false)
	in, err = store.ReadMemoryExtractInput(ctx, 1, genIncog)
	if err != nil || !in.Incognito {
		t.Fatalf("incognito read in=%+v err=%v", in, err)
	}

	// Missing and cross-owner generations fail closed.
	if _, err := store.ReadMemoryExtractInput(ctx, 1, 9_999_999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing generation err=%v want ErrNotFound", err)
	}
	if _, err := store.ReadMemoryExtractInput(ctx, 2, genID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner read err=%v want ErrNotFound", err)
	}
}

func TestCreateAutoSavedMemoryIntegration(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	// Write-phase consent gate: CreateAutoSavedMemory re-checks the outbound
	// authorization inside its own transaction, so the grant must precede the
	// first save (it used to be needed only for the later StartTurn below).
	grantOutboundConsents(t, store, 1)
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	_, srcID, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)

	create := AutoSavedMemoryCreate{
		RelationshipID: 10,
		ConversationID: conv,
		Summary:        "自动保存的合成记忆",
		Evidence:       []string{fmt.Sprintf("message:%d", srcID)},
		IdempotencyKey: "itest-auto-save-1",
	}
	mem, err := store.CreateAutoSavedMemory(ctx, 1, create)
	if err != nil {
		t.Fatal(err)
	}
	if !mem.AutoSaved || mem.Status != "ACCEPTED" || mem.Scope != "RELATIONSHIP" {
		t.Fatalf("auto-saved memory %+v", mem)
	}
	if mem.ConversationID == nil || *mem.ConversationID != conv {
		t.Fatalf("auto-saved conversation %+v want %d", mem.ConversationID, conv)
	}
	evi, err := store.ListMemoryEvidence(ctx, 1, mem.ID)
	if err != nil || len(evi) != 1 || evi[0].SourceRef != fmt.Sprintf("message:%d", srcID) {
		t.Fatalf("evidence %+v err=%v", evi, err)
	}

	// Defect fix: the auto-saved summary must rest encrypted (enc envelope,
	// never the plaintext), while every app read path returns plaintext.
	raw, err := psqlSuper(fmt.Sprintf(
		`SELECT summary FROM vc.memory_item WHERE owner_user_id = 1 AND id = %d`, mem.ID))
	if err != nil {
		t.Fatal(err)
	}
	if raw == create.Summary || !IsEncrypted(raw) {
		t.Fatalf("auto-saved summary not encrypted at rest: %q", raw)
	}
	got, err := store.GetMemory(ctx, 1, mem.ID)
	if err != nil || got.Summary != create.Summary {
		t.Fatalf("GetMemory summary %q err=%v want plaintext %q", got.Summary, err, create.Summary)
	}
	listed, err := store.ListMemories(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	seenPlaintext := false
	for _, m := range listed {
		if m.ID == mem.ID {
			seenPlaintext = m.Summary == create.Summary
		}
	}
	if !seenPlaintext {
		t.Fatalf("ListMemories did not return the auto-saved memory as plaintext")
	}

	// V126: the SQL-side summary ceiling no longer measures the ciphertext
	// envelope, so a plaintext at the Go-store 2000-rune limit persists
	// (its envelope is far longer than 2000 characters).
	long := strings.Repeat("记", maxSummaryRunes)
	longMem, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv, Summary: long,
		IdempotencyKey: "itest-auto-save-limit",
	})
	if err != nil {
		t.Fatalf("2000-rune summary rejected: %v", err)
	}
	rawLong, err := psqlSuper(fmt.Sprintf(
		`SELECT summary FROM vc.memory_item WHERE owner_user_id = 1 AND id = %d`, longMem.ID))
	if err != nil {
		t.Fatal(err)
	}
	if !IsEncrypted(rawLong) {
		t.Fatalf("limit summary not encrypted at rest: %d chars", len(rawLong))
	}

	// Same idempotency key returns the existing row instead of duplicating.
	mem2, err := store.CreateAutoSavedMemory(ctx, 1, create)
	if err != nil || mem2.ID != mem.ID {
		t.Fatalf("idempotent create mem2=%+v want id %d err=%v", mem2, mem.ID, err)
	}

	// Deleted/no_memory sources can never re-extract.
	_, deadID, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", true, false)
	if _, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv,
		Summary: "死源记忆", Evidence: []string{fmt.Sprintf("message:%d", deadID)},
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("no_memory source err=%v want ErrInvalid", err)
	}

	// Incognito conversations are rejected.
	incog, err := store.CreateConversation(ctx, 1, 10, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: incog, Summary: "隐身记忆",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incognito create err=%v want ErrInvalid", err)
	}

	// Evidence must use the strict "message:<id>" shape.
	if _, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv, Summary: "坏引用", Evidence: []string{"msg:1"},
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("bad evidence err=%v want ErrInvalid", err)
	}

	// Another owner's conversation id fails closed (not found for that owner).
	if _, err := store.CreateAutoSavedMemory(ctx, 2, AutoSavedMemoryCreate{
		RelationshipID: 20, ConversationID: conv, Summary: "越权记忆",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner create err=%v want ErrNotFound", err)
	}

	// RELATIONSHIP scope: the auto-saved memory must reach a NEW conversation
	// of the SAME relationship through LoadSeed (seed memories are filtered
	// per conversation for SESSION only), while conversation_id stays as
	// provenance.
	convNew, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	view, err := store.StartTurn(ctx, 1, StartTurn{
		ConversationID: convNew, IdempotencyKey: "auto-seed-turn-1",
		UserContent: "new-session-turn", Mode: "LISTEN", MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	seed, err := store.LoadSeed(ctx, turn.TurnKey{OwnerID: 1, TurnID: itoa(view.ID)})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, cand := range seed.EligibleMemories {
		if cand.SourceID == strconv.FormatInt(mem.ID, 10) {
			found = true
		}
	}
	if !found {
		t.Fatalf("auto-saved RELATIONSHIP memory %d missing from new-conversation seed %+v", mem.ID, seed.EligibleMemories)
	}
}

// TestCreateAutoSavedMemoryWritePhaseGuards covers the write-phase re-checks
// the extraction handler cannot cover: the handler validates pref/consent
// before the provider call, and the user may flip either during that call.
// The insert transaction re-reads both and refuses with ErrInvalid, which the
// jobs layer maps to the no-retry MEMORY_SOURCE_GUARDED close.
func TestCreateAutoSavedMemoryWritePhaseGuards(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	grantOutboundConsents(t, store, 1)
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	_, srcID, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	create := AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv,
		Summary:  "写入期守卫记忆",
		Evidence: []string{fmt.Sprintf("message:%d", srcID)},
		// One stable key across all phases: the guards must run before the
		// idempotent re-hit, so an off-pref retry can never resurrect a row.
		IdempotencyKey: "itest-write-phase-guard",
	}
	if _, err := store.CreateAutoSavedMemory(ctx, 1, create); err != nil {
		t.Fatal(err)
	}

	// Handler passed, then the owner flipped the kill switch: refused.
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAutoSavedMemory(ctx, 1, create); !errors.Is(err, ErrInvalid) {
		t.Fatalf("pref-off create err=%v want ErrInvalid", err)
	}

	// Consent withdrawn mid-flight (pref back on): refused the same way.
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordConsent(ctx, 1, "THIRD_PARTY_MODEL_PROCESSING", "2026-08", false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAutoSavedMemory(ctx, 1, create); !errors.Is(err, ErrInvalid) {
		t.Fatalf("consent-withdrawn create err=%v want ErrInvalid", err)
	}

	// Re-granting restores the path and the idempotent re-hit returns the
	// original row instead of duplicating.
	grantOutboundConsents(t, store, 1)
	mem, err := store.CreateAutoSavedMemory(ctx, 1, create)
	if err != nil {
		t.Fatal(err)
	}
	count, err := psqlSuper(fmt.Sprintf(
		`SELECT count(*) FROM vc.memory_item
		  WHERE owner_user_id = 1 AND auto_saved AND idempotency_key = 'itest-write-phase-guard'`))
	if err != nil {
		t.Fatal(err)
	}
	if n, err := strconv.Atoi(count); err != nil || n != 1 {
		t.Fatalf("idempotency-key rows=%s err=%v want exactly 1", count, err)
	}
	if mem.ID == 0 {
		t.Fatalf("re-hit returned empty memory %+v", mem)
	}
}

// beginOwnerWindowTx opens a dedicated runtime-role connection and starts a
// real transaction bound to the owner context, exactly the way WithOwner
// binds it. The interleaving tests use it to hold the "in-flight extraction
// write" window (the owner advisory barrier and/or the FOR SHARE source-row
// guard) while a second goroutine drives the real store path against it.
// Both transactions, locks, waits and the commit order are real; only the
// body of the in-flight write is simulated.
func beginOwnerWindowTx(t *testing.T, owner int64) (pgx.Tx, *pgx.Conn) {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, IsolationRuntimeDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(ctx) })
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	var pid int32
	var xact string
	if err := tx.QueryRow(ctx,
		"SELECT pg_backend_pid(), pg_current_xact_id()::text").Scan(&pid, &xact); err != nil {
		t.Fatal(err)
	}
	nonce, err := newNonce()
	if err != nil {
		t.Fatal(err)
	}
	proof := ProofFor([]byte(IsolationOwnerBindingSecret()), owner, strconv.Itoa(int(pid)), xact, nonce)
	if _, err := tx.Exec(ctx, "SELECT vc.set_owner_context($1, $2, $3)", owner, nonce, proof); err != nil {
		t.Fatalf("owner context rejected on window transaction: %v", err)
	}
	return tx, conn
}

// barrierLockProbe tries the owner-1 barrier key (-1, 1) in its own rolled
// back transaction: "f" while another transaction holds it, "t" when free.
func barrierLockProbe(t *testing.T) string {
	t.Helper()
	held, err := psqlSuper(`BEGIN; SELECT pg_try_advisory_xact_lock(-1, 1); ROLLBACK;`)
	if err != nil {
		t.Fatal(err)
	}
	return held
}

// TestCreateAutoSavedMemoryBarrierBlocksPrefClose is the lock-mutex proof for
// the pref close: with the owner write barrier held by a real in-flight
// window transaction, the real pref close must BLOCK (not complete), and
// only after the window ends may it commit — any write whose guards ran
// before the close either committed before it returned, or (like the write
// after the close below) reads the closed state and refuses.
func TestCreateAutoSavedMemoryBarrierBlocksPrefClose(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	grantOutboundConsents(t, store, 1)
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	_, srcID, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	// Positive regression: with the barrier in place the normal path still
	// lands (pref ON default, consents granted).
	if _, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv, Summary: "屏障正例记忆",
		Evidence:       []string{fmt.Sprintf("message:%d", srcID)},
		IdempotencyKey: "itest-barrier-positive",
	}); err != nil {
		t.Fatal(err)
	}

	// Window A: a real transaction holding the same owner barrier the
	// CreateAutoSavedMemory transaction takes as its first statement.
	tx, _ := beginOwnerWindowTx(t, 1)
	if _, err := tx.Exec(ctx, `SELECT vc.memory_write_barrier($1)`, int64(1)); err != nil {
		t.Fatal(err)
	}
	if probe := barrierLockProbe(t); probe != "f" {
		t.Fatalf("barrier probe=%q while the window holds it, want f", probe)
	}

	// Window B: the real pref close must block on the barrier.
	done := make(chan error, 1)
	go func() {
		_, err := store.UpdateMemoryAutoSavePref(context.Background(), 1, false)
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("pref close returned while the owner barrier was held (err=%v) — the mutex is broken", err)
	case <-time.After(700 * time.Millisecond):
	}
	if probe := barrierLockProbe(t); probe != "f" {
		t.Fatalf("barrier probe=%q during the blocked close, want f", probe)
	}

	// Releasing the window unblocks the close.
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("pref close after release: %v", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("pref close did not finish after the barrier was released")
	}
	if enabled, err := store.GetMemoryAutoSavePref(ctx, 1); err != nil || enabled {
		t.Fatalf("pref after close enabled=%v err=%v want false", enabled, err)
	}
	// The close has returned, so a fresh write reads the closed state and
	// refuses: no in-flight write can outlive a returned close anymore.
	if _, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv, Summary: "关闭后写入",
		IdempotencyKey: "itest-barrier-after-close",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("post-close create err=%v want ErrInvalid", err)
	}
	if n, err := psqlSuper(`SELECT count(*) FROM vc.memory_item
		  WHERE owner_user_id = 1 AND idempotency_key = 'itest-barrier-after-close'`); err != nil || n != "0" {
		t.Fatalf("post-close rows=%q err=%v want 0", n, err)
	}
}

// TestCreateAutoSavedMemoryBarrierBlocksSourceDelete is the lock-mutex proof
// for the source tombstone: with the guard's FOR SHARE read pinned in a real
// window transaction, the real DeleteMemory (whose V57 flip updates the same
// message row) must BLOCK; after the window commits the flip lands, and a
// write reusing the same evidence hits the tombstone and refuses.
func TestCreateAutoSavedMemoryBarrierBlocksSourceDelete(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	grantOutboundConsents(t, store, 1)
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	_, srcID, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	// The deleted memory's evidence points at srcID, so the V57 flip targets
	// exactly the row the guard window pins. (Also a positive-path landing.)
	memY, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv, Summary: "待删除来源记忆",
		Evidence:       []string{fmt.Sprintf("message:%d", srcID)},
		IdempotencyKey: "itest-tombstone-source",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Window A: the exact pinned source read the write guard performs — the
	// same vc.guard_auto_save_source call, whose FOR SHARE holds until this
	// transaction ends.
	tx, _ := beginOwnerWindowTx(t, 1)
	var noMemory, incog bool
	if err := tx.QueryRow(ctx, `
		SELECT out_no_memory, out_incognito
		  FROM vc.guard_auto_save_source($1, $2)`, int64(1), srcID).Scan(&noMemory, &incog); err != nil {
		t.Fatal(err)
	}
	if noMemory || incog {
		t.Fatalf("window source flags noMemory=%v incog=%v want false", noMemory, incog)
	}

	// Window B: the real delete must block on the pinned source row.
	done := make(chan error, 1)
	go func() {
		_, err := store.DeleteMemory(context.Background(), 1, memY.ID)
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("delete returned while the guard share lock was held (err=%v) — the mutex is broken", err)
	case <-time.After(700 * time.Millisecond):
	}
	// The flip has not landed and the delete is sitting in a real lock wait.
	flipped, err := psqlSuper(fmt.Sprintf(
		`SELECT no_memory FROM vc.message WHERE owner_user_id = 1 AND id = %d`, srcID))
	if err != nil || flipped != "f" {
		t.Fatalf("source flipped while guard held: %q err=%v", flipped, err)
	}
	waiting, err := psqlSuper(
		`SELECT count(*) FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'`)
	if err != nil || waiting == "0" {
		t.Fatalf("no transactionid lock wait for the blocked delete: %q err=%v", waiting, err)
	}

	// Committing the guard window releases the row; the delete then lands.
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("delete after release: %v", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("delete did not finish after the guard window ended")
	}
	if flipped, err := psqlSuper(fmt.Sprintf(
		`SELECT no_memory FROM vc.message WHERE owner_user_id = 1 AND id = %d`, srcID)); err != nil || flipped != "t" {
		t.Fatalf("tombstone flip after delete: %q err=%v want true", flipped, err)
	}
	// The same evidence can never re-extract after the delete returned.
	if _, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{
		RelationshipID: 10, ConversationID: conv, Summary: "墓碑后重提取",
		Evidence:       []string{fmt.Sprintf("message:%d", srcID)},
		IdempotencyKey: "itest-tombstone-reextract",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("tombstone re-extract err=%v want ErrInvalid", err)
	}
}
