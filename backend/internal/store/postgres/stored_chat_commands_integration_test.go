//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
)

func sx5AppendRequest(c StoredChat, docs ...ChatData) ChatAppendRequest {
	in := ChatAppendRequest{RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch}
	for _, doc := range docs {
		in.Messages = append(in.Messages, ChatAppendMessage{MessageID: chatUUID(), Data: doc})
	}
	return in
}

func sx5Append(t *testing.T, c StoredChat, in ChatAppendRequest) ChatCommit {
	t.Helper()
	out, err := testEnv.store.AppendStoredMessages(t.Context(), 1, c.ChatID, in)
	if err != nil {
		t.Fatalf("append: %v", err)
	}
	return out
}

func sx5Page(t *testing.T, c StoredChat) StoredMessagePage {
	t.Helper()
	out, err := testEnv.store.ListStoredMessages(t.Context(), 1, c.ChatID, ChatMessageQuery{View: "full", IncludeChat: true})
	if err != nil {
		t.Fatalf("read history: %v", err)
	}
	return out
}

func sx5Field(path []string, before, after any) ChatFieldChange {
	return ChatFieldChange{Path: path, Before: ChatFieldValue{Exists: true, Value: before}, After: ChatFieldValue{Exists: true, Value: after}}
}

func sx5Operation(t *testing.T, kind string, target, guards, payload any) ChatOperation {
	t.Helper()
	encode := func(value any) json.RawMessage {
		out, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("encode %s operation: %v", kind, err)
		}
		return out
	}
	return ChatOperation{Kind: kind, Target: encode(target), Preconditions: encode(guards), Payload: encode(payload)}
}

func sx5Operations(c StoredChat, operations ...ChatOperation) ChatOperationsRequest {
	return ChatOperationsRequest{RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, Operations: operations}
}

func sx5Swipe(t *testing.T, m StoredMessage, kind, candidate string) ChatOperation {
	t.Helper()
	target := ChatData{"messageId": m.MessageID}
	guards := ChatData{"messageRevision": strconv.FormatInt(m.Revision, 10)}
	var payload any
	switch kind {
	case "addSwipe":
		payload = ChatData{"candidate": ChatData{"candidateId": candidate, "data": ChatData{"mes": "synthetic alternate"}}}
	case "selectSwipe":
		target["candidateId"] = candidate
		guards["selectedCandidateId"] = m.SelectedCandidateID
	}
	return sx5Operation(t, kind, target, guards, payload)
}

func sx5Reorder(t *testing.T, page StoredMessagePage, first, last string, order ...string) ChatOperation {
	t.Helper()
	return sx5Operation(t, "reorder", ChatData{"firstMessageId": first, "lastMessageId": last},
		ChatData{"orderRevision": strconv.FormatInt(page.OrderRevision, 10)}, ChatData{"messageIds": order})
}

func TestStoredChatSX5AppendReceiptsAndTombstone(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	in := sx5AppendRequest(c, ChatData{"mes": "synthetic"})
	first := sx5Append(t, c, in)
	if len(first.Changed) != 1 || first.Changed[0].MessageID != in.Messages[0].MessageID {
		t.Fatal("append receipt omitted the canonical message")
	}
	if replay := sx5Append(t, c, in); !reflect.DeepEqual(first, replay) {
		t.Fatal("same request did not return the original receipt")
	}

	changed := in
	changed.Messages = []ChatAppendMessage{{MessageID: in.Messages[0].MessageID, Data: ChatData{"mes": "synthetic variant"}}}
	_, err := s.AppendStoredMessages(ctx, 1, c.ChatID, changed)
	expectChatCode(t, err, "IDEMPOTENCY_KEY_REUSED")

	retry := in
	retry.RequestID = chatUUID()
	sx5Append(t, c, retry)
	page := sx5Page(t, c)
	if len(page.Items) != 1 || page.Items[0].SelectedCandidateID != first.Changed[0].SelectedCandidateID ||
		page.Items[0].Position != first.Changed[0].Position {
		t.Fatal("retry by clientMessageId changed the stable message or candidate")
	}
	changed.RequestID = chatUUID()
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, changed)
	expectChatCode(t, err, "CHAT_ID_REUSED")

	m := page.Items[0]
	del := sx5Swipe(t, m, "delete", "")
	if _, err = s.ApplyStoredChatOperations(ctx, 1, c.ChatID, sx5Operations(c, del)); err != nil {
		t.Fatalf("delete message: %v", err)
	}
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, in)
	expectChatCode(t, err, "OPERATION_RESULT_EXPIRED")
	retry.RequestID = chatUUID()
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, retry)
	expectChatCode(t, err, "CHAT_ID_REUSED")
	if _, err = s.GetStoredMessage(ctx, 1, c.ChatID, m.MessageID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted message read: %v", err)
	}
	if err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var compact bool
		if err := tx.QueryRow(ctx, `SELECT result_cipher IS NULL AND octet_length(request_digest)>0
 FROM vc.chat_receipt WHERE owner_user_id=1 AND chat_id=$1 AND request_id=$2`, c.ChatID, in.RequestID).Scan(&compact); err != nil {
			return err
		}
		if !compact {
			t.Error("deletion did not preserve only the compact append receipt")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestStoredChatSX5ConditionalEdits(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	sx5Append(t, c, sx5AppendRequest(c, ChatData{
		"mes": "synthetic selected", "swipes": []string{"synthetic selected", "synthetic alternate"},
		"extension": ChatData{"a": "original", "b": nil, "unrelated": true},
		"variables": []any{nil, ChatData{"x": "original", "y": "original"}},
	}))
	m := sx5Page(t, c).Items[0]
	selected, alternate := m.Candidates[0], m.Candidates[1]
	edit := func(base int64, candidate *string, change ChatFieldChange) (ChatCommit, error) {
		return s.EditStoredMessage(ctx, 1, c.ChatID, m.MessageID, ChatMessageEditRequest{
			RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, BaseRevision: base, CandidateID: candidate, Changes: []ChatFieldChange{change},
		})
	}
	if _, err := edit(m.Revision, nil, sx5Field([]string{"extension", "a"}, "original", "changed")); err != nil {
		t.Fatal(err)
	}
	b := sx5Field([]string{"extension", "b"}, nil, "present")
	absentB := b
	absentB.Before = ChatFieldValue{}
	_, err := edit(m.Revision, nil, absentB)
	expectChatCode(t, err, "REVISION_CONFLICT")
	rebased, err := edit(m.Revision, nil, b)
	if err != nil || !rebased.Rebased {
		t.Fatalf("disjoint unknown-field rebase: %v", err)
	}
	_, err = edit(m.Revision, nil, sx5Field([]string{"extension", "a"}, "original", "racing change"))
	expectChatCode(t, err, "REVISION_CONFLICT")

	before := ChatData{"x": "original", "y": "original"}
	after := ChatData{"x": "changed", "y": "original"}
	rebased, err = edit(m.Revision, &alternate.CandidateID, sx5Field([]string{"variables"}, before, after))
	if err != nil || !rebased.Rebased {
		t.Fatalf("explicit alternate candidate rebase: %v", err)
	}
	_, err = edit(m.Revision, &alternate.CandidateID, sx5Field([]string{"variables"}, before, ChatData{"x": "original", "y": "racing change"}))
	expectChatCode(t, err, "REVISION_CONFLICT")

	got := sx5Page(t, c).Items[0]
	extension, ok := got.Data["extension"].(map[string]any)
	if !ok || extension["a"] != "changed" || extension["b"] != "present" || extension["unrelated"] != true {
		t.Fatal("unknown-field rebase overwrote a sibling")
	}
	if got.SelectedCandidateID != selected.CandidateID || !reflect.DeepEqual(got.Candidates[0], selected) ||
		got.Candidates[1].CandidateID != alternate.CandidateID ||
		!reflect.DeepEqual(got.Candidates[1].Data["variables"], map[string]any{"x": "changed", "y": "original"}) {
		t.Fatal("alternate candidate edit changed the selected candidate or lost the variable tree")
	}
}

func TestStoredChatSX5BatchAtomicityAndInitialPreconditions(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "synthetic"}))
	before := sx5Page(t, c)
	m := before.Items[0]
	appendIn := sx5AppendRequest(c, ChatData{"mes": "synthetic staged append"})
	appendOp := sx5Operation(t, "append", ChatData{}, ChatData{}, ChatData{"messages": appendIn.Messages})
	newCandidate := chatUUID()
	add := sx5Swipe(t, m, "addSwipe", newCandidate)
	// All guards pass at transaction start. The last command fails after
	// applying an append and adding a candidate, because its target never exists.
	missing := sx5Swipe(t, m, "selectSwipe", chatUUID())
	batch := sx5Operations(c, appendOp, add, missing)
	_, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, batch)
	expectChatCode(t, err, "REVISION_CONFLICT")

	if after := sx5Page(t, c); after.Revision != before.Revision || !reflect.DeepEqual(after.Items, before.Items) {
		t.Fatal("failed batch changed history or its revision")
	}
	changes, err := s.ListStoredChatChanges(ctx, 1, c.ChatID, before.Revision, 10)
	if err != nil || len(changes.Items) != 0 {
		t.Fatalf("failed batch produced an outbox event: %v", err)
	}
	if err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var leaked bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.chat_receipt WHERE owner_user_id=1 AND request_id=$1)
 OR EXISTS(SELECT 1 FROM vc.stored_message WHERE owner_user_id=1 AND chat_id=$2 AND message_id=$3)`,
			batch.RequestID, c.ChatID, appendIn.Messages[0].MessageID).Scan(&leaked)
		if leaked {
			t.Error("failed batch left a receipt or a message row")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}

	selectNew := sx5Swipe(t, m, "selectSwipe", newCandidate)
	out, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, sx5Operations(c, add, selectNew))
	if err != nil {
		t.Fatalf("add and select against the same initial revision: %v", err)
	}
	if len(out.Changed) != 1 || out.Changed[0].CandidateCount != 2 || out.Changed[0].Revision != m.Revision+1 ||
		out.Changed[0].SelectedCandidateID != newCandidate || out.Revision != before.Revision+1 {
		t.Fatal("successful add+select did not produce one version and the new selection")
	}
}

func TestStoredChatSX5ReorderAndFork(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	meta, err := s.EditStoredChatMetadata(ctx, 1, c.ChatID, ChatMetadataEditRequest{
		RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, BaseRevision: c.MetadataRevision,
		Changes: []ChatFieldChange{
			{Path: []string{"header", "extension"}, After: ChatFieldValue{Exists: true, Value: true}},
			{Path: []string{"metadata", "extension"}, After: ChatFieldValue{Exists: true, Value: ChatData{"preserved": true}}},
		},
	})
	if err != nil || meta.Chat == nil {
		t.Fatalf("seed parent metadata: %v", err)
	}
	sx5Append(t, c, sx5AppendRequest(c,
		ChatData{"mes": "synthetic first", "extension": ChatData{"preserved": true}, "swipes": []string{"synthetic first", "synthetic alternate"},
			"swipe_info": []any{ChatData{}, ChatData{"extension": ChatData{"kept": true}}}, "variables": []any{nil, ChatData{"kept": true}}},
		ChatData{"mes": "synthetic second"},
		ChatData{"mes": "synthetic third"},
	))
	before := sx5Page(t, c)
	if len(before.Items) != 3 || before.BeforeCursor == nil {
		t.Fatal("seed history did not produce a cursor and three messages")
	}
	a, b, tail := before.Items[0], before.Items[1], before.Items[2]
	reorder := sx5Reorder(t, before, a.MessageID, b.MessageID, b.MessageID, a.MessageID)
	if _, err = s.ApplyStoredChatOperations(ctx, 1, c.ChatID, sx5Operations(c, reorder)); err != nil {
		t.Fatalf("reorder interval: %v", err)
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *before.BeforeCursor, View: "full"})
	expectChatCode(t, err, "CHAT_CURSOR_EXPIRED")

	page := sx5Page(t, c)
	if len(page.Items) != 3 || page.OrderRevision != before.OrderRevision+1 {
		t.Fatal("reorder did not advance the order revision")
	}
	for i, want := range []StoredMessage{b, a, tail} {
		got := page.Items[i]
		want.Position = before.Items[i].Position
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("reorder changed content, message revision or candidate source identity at position %d", i)
		}
	}

	fork := ChatForkRequest{RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch, ParentRevision: before.Revision, ThroughID: a.MessageID}
	_, err = s.ForkStoredChat(ctx, 1, c.ChatID, fork)
	expectChatCode(t, err, "REVISION_CONFLICT")
	fork.ParentRevision = page.Revision
	child, err := s.ForkStoredChat(ctx, 1, c.ChatID, fork)
	if err != nil {
		t.Fatalf("fork current parent prefix: %v", err)
	}
	childPage := sx5Page(t, child.Chat)
	if child.Chat.ChatID == c.ChatID || child.Chat.BranchRoot != c.BranchRoot || childPage.Chat.BranchRoot != c.BranchRoot ||
		len(child.Mapping) != 2 || len(childPage.Items) != 2 || childPage.Chat.MessageCount != 2 ||
		childPage.Chat.Header["extension"] != true || !reflect.DeepEqual(childPage.Chat.Metadata, meta.Chat.Metadata) {
		t.Fatal("fork did not create a new chat with its complete prefix and parent metadata")
	}
	for i, mapped := range child.Mapping {
		parent, copied := page.Items[i], childPage.Items[i]
		if mapped.ParentMessageID != parent.MessageID || mapped.MessageID == parent.MessageID || mapped.MessageID != copied.MessageID ||
			copied.Data["vc_message_id"] != copied.MessageID || !reflect.DeepEqual(copied.Data["extension"], parent.Data["extension"]) ||
			len(mapped.Candidates) != len(parent.Candidates) || len(copied.Candidates) != len(parent.Candidates) {
			t.Fatalf("fork did not remap message or preserve its data at position %d", i)
		}
		for j, candidateMap := range mapped.Candidates {
			oldCandidate, newCandidate := parent.Candidates[j], copied.Candidates[j]
			if candidateMap.ParentCandidateID != oldCandidate.CandidateID || candidateMap.CandidateID == oldCandidate.CandidateID ||
				candidateMap.CandidateID != newCandidate.CandidateID ||
				(copied.SelectedCandidateID == newCandidate.CandidateID) != (parent.SelectedCandidateID == oldCandidate.CandidateID) ||
				!reflect.DeepEqual(newCandidate.Data["extension"], oldCandidate.Data["extension"]) ||
				!reflect.DeepEqual(newCandidate.Data["variables"], oldCandidate.Data["variables"]) ||
				newCandidate.Data["mes"] != oldCandidate.Data["mes"] {
				t.Fatalf("fork lost a candidate, selection or unknown data at position %d candidate %d", i, j)
			}
		}
	}
}

func TestStoredChatSX5ConcurrentAppends(t *testing.T) {
	c := storedChatFixture(t)
	start := make(chan struct{})
	results := make(chan error, 2)
	first := sx5AppendRequest(c, ChatData{"mes": "synthetic first"})
	second := sx5AppendRequest(c, ChatData{"mes": "synthetic second"})
	for _, in := range []ChatAppendRequest{first, second} {
		go func() {
			<-start
			_, err := testEnv.store.AppendStoredMessages(t.Context(), 1, c.ChatID, in)
			results <- err
		}()
	}
	close(start)
	for range 2 {
		if err := <-results; err != nil {
			t.Errorf("concurrent append: %v", err)
		}
	}
	page := sx5Page(t, c)
	seen := map[string]bool{}
	for _, m := range page.Items {
		seen[m.MessageID] = true
	}
	if len(page.Items) != 2 || page.Revision != c.Revision+2 || page.Items[0].Position == page.Items[1].Position ||
		!seen[first.Messages[0].MessageID] || !seen[second.Messages[0].MessageID] {
		t.Fatal("concurrent append lost a message, position or revision")
	}
}
