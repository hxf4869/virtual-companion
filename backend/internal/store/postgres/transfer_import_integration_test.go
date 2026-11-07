//go:build integration

package postgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/jackc/pgx/v5"
)

type transferTestObjects map[string][]byte

func (o transferTestObjects) Put(_ context.Context, k string, b []byte) (int64, error) {
	o[k] = append([]byte(nil), b...)
	return int64(len(b)), nil
}
func (o transferTestObjects) GetLimited(_ context.Context, k string, n int64) ([]byte, error) {
	b, ok := o[k]
	if !ok || int64(len(b)) > n {
		return nil, fmt.Errorf("synthetic missing chunk")
	}
	return append([]byte(nil), b...), nil
}
func (o transferTestObjects) Delete(_ context.Context, k string) error { delete(o, k); return nil }
func (o transferTestObjects) ListKeys(_ context.Context, prefix, after string, limit int) ([]string, error) {
	out := []string{}
	for k := range o {
		if strings.HasPrefix(k, prefix) && k > after {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
func stageTransferFixture(t *testing.T, body string, objects chattransfer.Objects) (ChatTransferIntent, chattransfer.Manifest, string) {
	t.Helper()
	ctx := context.Background()
	intent, e := testEnv.store.BeginChatTransfer(ctx, 1)
	if e != nil {
		t.Fatal(e)
	}
	w := chattransfer.NewWriter(ctx, objects, intent.Prefix, 256<<20)
	if _, e = w.Write([]byte(body)); e != nil {
		t.Fatal(e)
	}
	m, e := w.Seal()
	if e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256([]byte(body))
	return intent, m, fmt.Sprintf("%x", sum[:])
}
func TestSX8PublicImportCheckpointAndAtomicFailure(t *testing.T) {
	storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	group := "import-group"
	body := "{\"unknown\":900719925474099312345,\"chat_metadata\":{\"variables\":{\"x\":999999999999999999}}}\n{\"mes\":\"selected\",\"is_user\":true,\"swipes\":[\"selected\",\"other\"],\"swipe_id\":0,\"variables\":[{\"a\":1},{\"a\":2}],\"swipe_info\":[{\"x\":true},{\"custom\":false}]}\n"
	intent, m, hash := stageTransferFixture(t, body, objects)
	in := ChatImportRequest{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group}
	accepted, e := s.SealChatImport(ctx, 1, in, intent.ID, m, hash)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, objects); e != nil {
		t.Fatal(e)
	}
	result, e := s.GetChatImport(ctx, 1, accepted.ImportID)
	if e != nil || result.Status != "DONE" || result.ChatID == nil {
		t.Fatalf("result %v %+v", e, result)
	}
	var out bytes.Buffer
	if _, e = s.CaptureStoredChatJSONL(ctx, 1, *result.ChatID, nil, &out); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(out.String(), "900719925474099312345") || !strings.Contains(out.String(), "other") || !strings.Contains(out.String(), "999999999999999999") {
		t.Fatal("lost full JSONL fields")
	}
	again, e := s.SealChatImport(ctx, 1, in, intent.ID, m, hash)
	if e != nil || again.ImportID != accepted.ImportID || again.Status != "PENDING" {
		t.Fatalf("replay %v %+v", e, again)
	}
	badIntent, bad, hash := stageTransferFixture(t, body+"{bad\n", objects)
	in.RequestID = chatUUID()
	accepted, e = s.SealChatImport(ctx, 1, in, badIntent.ID, bad, hash)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, objects); e != nil {
		t.Fatal(e)
	}
	result, e = s.GetChatImport(ctx, 1, accepted.ImportID)
	if e != nil || result.Status != "FAILED" || result.ChatID != nil || len(result.Issues) != 1 {
		t.Fatalf("bad last line %v %+v", e, result)
	}
}
func TestSX8NativeStrictCASAliasesAndTombstones(t *testing.T) {
	storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	group := "native-group"
	scope := NativeChatScope{Kind: "GROUP", GroupRef: &group}
	intent, m, hash := stageTransferFixture(t, "{}\n{\"mes\":\"hello\",\"is_user\":true}\n", objects)
	in := NativeChatUpload{RequestID: chatUUID(), AuthorityEpoch: 2, Scope: scope, ChatID: chatUUID(), FileName: "original.jsonl"}
	created, e := s.WriteNativeChat(ctx, 1, "create", in, intent.ID, m, hash, objects)
	if e != nil {
		t.Fatal(e)
	}
	if created.Chat.ChatID != in.ChatID || created.Chat.Revision != 1 {
		t.Fatal("create ACK identity")
	}
	var body bytes.Buffer
	if _, e = s.CaptureStoredChatJSONL(ctx, 1, in.ChatID, nil, &body); e != nil {
		t.Fatal(e)
	}
	intent, m, hash = stageTransferFixture(t, body.String(), objects)
	in.RequestID = chatUUID()
	in.ChatRevision = 1
	saved, e := s.WriteNativeChat(ctx, 1, "save", in, intent.ID, m, hash, objects)
	if e != nil {
		t.Fatal(e)
	}
	if saved.Chat.Revision != 2 || saved.IdentityMapping[0].MessageID != created.IdentityMapping[0].MessageID {
		t.Fatal("save remapped identity")
	}
	in.RequestID = chatUUID()
	_, e = s.WriteNativeChat(ctx, 1, "save", in, intent.ID, m, hash, objects)
	expectChatCode(t, e, "REVISION_CONFLICT")
	rename := NativeChatMutation{RequestID: chatUUID(), AuthorityEpoch: 2, Scope: scope, Target: NativeChatTarget{FileName: "original.jsonl", ChatID: in.ChatID, ChatRevision: 2}, ToFileName: "new.jsonl"}
	ack, e := s.RenameNativeChat(ctx, 1, rename)
	if e != nil || ack.Result.ChatRevision != 3 {
		t.Fatalf("rename %v", e)
	}
	old, e := s.ResolveNativeChat(ctx, 1, scope, "original.jsonl", 2)
	if e != nil || old.ChatID != in.ChatID || old.FileName != "new.jsonl" {
		t.Fatalf("old alias %v", e)
	}
	rename.RequestID = chatUUID()
	rename.Target.ChatRevision = 3
	ack, e = s.DeleteNativeChat(ctx, 1, rename)
	if e != nil || !ack.Result.Deleted {
		t.Fatalf("delete %v", e)
	}
	_, e = s.ResolveNativeChat(ctx, 1, scope, "original.jsonl", 2)
	if e != ErrNotFound {
		t.Fatalf("deleted alias %v", e)
	}
	in.ChatRevision = 0
	in.RequestID = chatUUID()
	_, e = s.WriteNativeChat(ctx, 1, "create", in, intent.ID, m, hash, objects)
	expectChatCode(t, e, "CHAT_ID_REUSED")
}

func TestSX8NativeTailAppendAndNewIdentities(t *testing.T) {
	c := storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	appended := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "initial", "is_user": true}))
	var body bytes.Buffer
	if _, e := s.CaptureStoredChatJSONL(ctx, 1, c.ChatID, nil, &body); e != nil {
		t.Fatal(e)
	}
	old := body.String()
	intent, m, hash := stageTransferFixture(t, old, objects)
	scope := NativeChatScope{Kind: c.Kind, GroupRef: c.GroupRef}
	in := NativeChatUpload{RequestID: chatUUID(), AuthorityEpoch: 2, Scope: scope, ChatID: c.ChatID, ChatRevision: appended.Revision, FileName: c.ChatID + ".jsonl"}
	sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "unrelated tail", "is_user": true}))
	_, e := s.WriteNativeChat(ctx, 1, "save", in, intent.ID, m, hash, objects)
	expectChatCode(t, e, "REVISION_CONFLICT")
	if body.String() != old {
		t.Fatal("stale save changed serialized draft")
	}
	current, e := s.GetStoredChat(ctx, 1, c.ChatID)
	if e != nil || current.MessageCount != 2 {
		t.Fatal("tail overwritten")
	}
	// A new local UUID is a mapping token, never permission to resurrect a known identity.
	body.Reset()
	if _, e = s.CaptureStoredChatJSONL(ctx, 1, c.ChatID, nil, &body); e != nil {
		t.Fatal(e)
	}
	newID := chatUUID()
	body.WriteString(fmt.Sprintf("{\"mes\":\"fresh local\",\"is_user\":true,\"vc_message_id\":%q}\n", newID))
	intent, m, hash = stageTransferFixture(t, body.String(), objects)
	in.RequestID = chatUUID()
	in.ChatRevision = current.Revision
	saved, e := s.WriteNativeChat(ctx, 1, "save", in, intent.ID, m, hash, objects)
	if e != nil {
		t.Fatal(e)
	}
	if saved.Chat.Revision != current.Revision+1 || saved.IdentityMapping[2].MessageID == newID || *saved.IdentityMapping[2].InputMessageID != newID {
		t.Fatal("fresh UUID was not server-remapped")
	}
	zero := int64(0)
	_, e = s.CaptureStoredChatJSONL(ctx, 1, c.ChatID, &zero, &bytes.Buffer{})
	expectChatCode(t, e, "REVISION_CONFLICT")
}

type failPreparedTransferObjects struct {
	transferTestObjects
	inputPrefix string
	failed      bool
}

func (o *failPreparedTransferObjects) GetLimited(ctx context.Context, key string, n int64) ([]byte, error) {
	if !strings.HasPrefix(key, o.inputPrefix) && !o.failed {
		o.failed = true
		return nil, fmt.Errorf("synthetic transient object failure")
	}
	return o.transferTestObjects.GetLimited(ctx, key, n)
}
func TestSX8ImportDurablePrepareLeaseAndEpochFence(t *testing.T) {
	storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	group := "lease-group"
	intent, m, hash := stageTransferFixture(t, "{}\n{\"mes\":\"lease synthetic\",\"is_user\":true}\n", objects)
	in := ChatImportRequest{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group}
	accepted, e := s.SealChatImport(ctx, 1, in, intent.ID, m, hash)
	if e != nil {
		t.Fatal(e)
	}
	failedObjects := &failPreparedTransferObjects{transferTestObjects: objects, inputPrefix: intent.Prefix}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, failedObjects); e == nil {
		t.Fatal("transient failure accepted")
	}
	state, e := s.GetChatImport(ctx, 1, accepted.ImportID)
	if e != nil || state.Status != "PENDING" {
		t.Fatalf("transient became terminal: %v %+v", e, state)
	}
	var preparedCipher string
	e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT prepared_cipher FROM vc.chat_import WHERE owner_user_id=1 AND import_id=$1`, accepted.ImportID).Scan(&preparedCipher)
	})
	if e != nil {
		t.Fatal(e)
	}
	var prepared preparedTransfer
	if e = s.decodeChatJSON(preparedCipher, &prepared); e != nil {
		t.Fatal(e)
	}
	// A second process cannot claim a live lease or republish a partial chat.
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, objects); e != nil {
		t.Fatal(e)
	}
	state, _ = s.GetChatImport(ctx, 1, accepted.ImportID)
	if state.Status != "PENDING" {
		t.Fatal("live lease stolen")
	}
	if _, e = psqlSuper(`UPDATE vc.chat_import SET lease_until=now()-interval '1 second' WHERE owner_user_id=1`); e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, objects); e != nil {
		t.Fatal(e)
	}
	state, e = s.GetChatImport(ctx, 1, accepted.ImportID)
	if e != nil || state.Status != "DONE" {
		t.Fatalf("resume %v", e)
	}
	page, e := s.ListStoredMessages(ctx, 1, *state.ChatID, ChatMessageQuery{View: "full"})
	if e != nil || len(page.Items) != 1 || page.Items[0].MessageID != prepared.IDs[0] {
		t.Fatal("resume rerolled identities")
	}
	intent, m, hash = stageTransferFixture(t, "{}\n", objects)
	in.RequestID = chatUUID()
	accepted, e = s.SealChatImport(ctx, 1, in, intent.ID, m, hash)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = psqlSuper(`UPDATE vc.chat_authority SET authority='FROZEN',epoch=3 WHERE owner_user_id=1`); e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, objects); e != nil {
		t.Fatal(e)
	}
	state, e = s.GetChatImport(ctx, 1, accepted.ImportID)
	if e != nil || state.Status != "FAILED" || state.FailureCode == nil || *state.FailureCode != "CHAT_AUTHORITY_CHANGED" {
		t.Fatalf("epoch fence %v %+v", e, state)
	}
}

func TestSX8NativeSingleRewriteAndForkKeepSourceRights(t *testing.T) {
	c := sx7SourceChat(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	appended := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "first source", "is_user": true, "swipes": []any{"first source", "second source"}, "swipe_id": 0}))
	message := appended.Changed[0]
	_, e := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, ChatOperationsRequest{RequestID: chatUUID(), AuthorityEpoch: 2, Operations: []ChatOperation{sx5Swipe(t, message, "selectSwipe", message.Candidates[1].CandidateID)}})
	if e != nil {
		t.Fatal(e)
	}
	// Source-level forgetting is monotonic through the native branch copy.
	super, e := pgx.Connect(ctx, testEnv.superDSN)
	if e != nil {
		t.Fatal(e)
	}
	defer super.Close(ctx)
	tx, e := super.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.bindOwner(ctx, tx, 1); e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, `UPDATE vc.st_message_source SET suppressed=true WHERE owner_user_id=1 AND conversation_id=$1 AND candidate_id=$2`, *c.ConversationID, message.Candidates[0].CandidateID); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	var body bytes.Buffer
	snapshot, e := s.CaptureStoredChatJSONL(ctx, 1, c.ChatID, nil, &body)
	if e != nil {
		t.Fatal(e)
	}
	intent, m, hash := stageTransferFixture(t, body.String(), objects)
	scope := NativeChatScope{Kind: c.Kind, CharacterRef: c.CharacterRef}
	fork := NativeChatUpload{RequestID: chatUUID(), AuthorityEpoch: 2, Scope: scope, ChatID: chatUUID(), ParentChatID: c.ChatID, ParentRevision: snapshot.Revision, FileName: "native-fork.jsonl"}
	result, e := s.WriteNativeChat(ctx, 1, "fork", fork, intent.ID, m, hash, objects)
	if e != nil {
		t.Fatal(e)
	}
	if result.Chat.ChatID != fork.ChatID || result.Chat.Revision != 1 || result.Chat.BranchRoot != c.BranchRoot || *result.Chat.RelationshipID != *c.RelationshipID {
		t.Fatal("fork lost parent binding")
	}
	var suppressed bool
	e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT suppressed FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND candidate_id=$2`, *result.Chat.ConversationID, result.IdentityMapping[0].Candidates[0].CandidateID).Scan(&suppressed)
	})
	if e != nil || !suppressed {
		t.Fatal("fork cleared suppression")
	}
	// Rewrite every selected body once; source counters must advance with the ACK.
	body.Reset()
	snapshot, e = s.CaptureStoredChatJSONL(ctx, 1, c.ChatID, nil, &body)
	if e != nil {
		t.Fatal(e)
	}
	rewritten := strings.ReplaceAll(body.String(), "second source", "changed source")
	intent, m, hash = stageTransferFixture(t, rewritten, objects)
	save := NativeChatUpload{RequestID: chatUUID(), AuthorityEpoch: 2, Scope: scope, ChatID: c.ChatID, ChatRevision: snapshot.Revision, FileName: c.ChatID + ".jsonl"}
	result, e = s.WriteNativeChat(ctx, 1, "save", save, intent.ID, m, hash, objects)
	if e != nil {
		t.Fatal(e)
	}
	mapping := result.IdentityMapping[0].Candidates[1]
	if mapping.SourceRevision != 2 || mapping.SourceGeneration != 2 {
		t.Fatalf("source counters %d %d", mapping.SourceRevision, mapping.SourceGeneration)
	}
	var text string
	var revision, generation int64
	e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT content_cipher,source_revision,source_generation FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND candidate_id=$2 AND present`, *c.ConversationID, mapping.CandidateID).Scan(&text, &revision, &generation)
	})
	if e != nil || text != "changed source" || revision != 2 || generation != 2 {
		t.Fatalf("source publication %v", e)
	}
}

func TestSX8EmptyImportAndExpiredReplay(t *testing.T) {
	storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	group := "empty-group"
	intent, m, hash := stageTransferFixture(t, "", objects)
	in := ChatImportRequest{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group}
	accepted, e := s.SealChatImport(ctx, 1, in, intent.ID, m, hash)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, objects); e != nil {
		t.Fatal(e)
	}
	result, e := s.GetChatImport(ctx, 1, accepted.ImportID)
	if e != nil || result.Status != "FAILED" || len(result.Issues) != 1 || result.Issues[0].Line != 1 || result.Issues[0].Reason != "INVALID_HEADER" {
		t.Fatalf("empty import %v %+v", e, result)
	}
	if _, e = psqlSuper(`UPDATE vc.chat_import SET expires_at=now()-interval '1 second' WHERE owner_user_id=1`); e != nil {
		t.Fatal(e)
	}
	_, e = s.SealChatImport(ctx, 1, in, intent.ID, m, hash)
	expectChatCode(t, e, "CHAT_IMPORT_EXPIRED")
	_, e = s.GetChatImport(ctx, 1, accepted.ImportID)
	expectChatCode(t, e, "CHAT_IMPORT_EXPIRED")
	intent, e = s.BeginChatTransfer(ctx, 0)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.ReleaseChatTransfer(ctx, 0, intent.ID); e != nil {
		t.Fatal(e)
	}
	var released bool
	e = s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT released FROM vc.list_chat_transfer_cleanup(256) WHERE transfer_id=$1`, intent.ID).Scan(&released)
	})
	if e != nil || !released {
		t.Fatal("unbound release not scheduled")
	}
}

type delayPreparedTransferObjects struct {
	transferTestObjects
	inputPrefix string
}

func (o delayPreparedTransferObjects) GetLimited(ctx context.Context, key string, n int64) ([]byte, error) {
	if !strings.HasPrefix(key, o.inputPrefix) {
		time.Sleep(350 * time.Millisecond)
	}
	return o.transferTestObjects.GetLimited(ctx, key, n)
}
func TestSX8ImportExpiryDuringFinalTransactionRollsBack(t *testing.T) {
	storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	group := "expired-commit-group"
	intent, m, hash := stageTransferFixture(t, "{}\n{\"mes\":\"expiry synthetic\",\"is_user\":true}\n", objects)
	in := ChatImportRequest{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group}
	accepted, e := s.SealChatImport(ctx, 1, in, intent.ID, m, hash)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, &failPreparedTransferObjects{objects, intent.Prefix, false}); e == nil {
		t.Fatal("missing transient checkpoint stop")
	}
	if _, e = psqlSuper(`UPDATE vc.chat_import SET lease_until=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '200 milliseconds' WHERE owner_user_id=1`); e != nil {
		t.Fatal(e)
	}
	e = s.ProcessChatImport(ctx, 1, accepted.ImportID, delayPreparedTransferObjects{objects, intent.Prefix})
	expectChatCode(t, e, "CHAT_IMPORT_EXPIRED")
	var published int
	e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.stored_chat WHERE owner_user_id=1 AND chat_id=(SELECT chat_id FROM vc.chat_import WHERE owner_user_id=1 AND import_id=$1)`, accepted.ImportID).Scan(&published)
	})
	if e != nil || published != 0 {
		t.Fatal("expired final transaction published")
	}
}

func TestSX8CanonicalMessageTooLargeIsTerminalInputFailure(t *testing.T) {
	storedChatFixture(t)
	s := testEnv.store
	ctx := context.Background()
	objects := transferTestObjects{}
	group := "canonical-size"
	body := "{}\n{\"is_user\":true,\"mes\":\"" + strings.Repeat("x", 600<<10) + "\"}\n"
	intent, m, hash := stageTransferFixture(t, body, objects)
	accepted, e := s.SealChatImport(ctx, 1, ChatImportRequest{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group}, intent.ID, m, hash)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.ProcessChatImport(ctx, 1, accepted.ImportID, objects); e != nil {
		t.Fatal(e)
	}
	result, e := s.GetChatImport(ctx, 1, accepted.ImportID)
	if e != nil || result.Status != "FAILED" || result.FailureCode == nil || *result.FailureCode != "CHAT_PAYLOAD_TOO_LARGE" || len(result.Issues) != 1 || result.Issues[0].Line != 2 || result.Issues[0].Reason != "MESSAGE_TOO_LARGE" {
		t.Fatalf("canonical size not terminal input error: %v %+v", e, result)
	}
}
