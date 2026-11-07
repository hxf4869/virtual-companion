//go:build integration

package postgres

import (
	"errors"
	"fmt"
	"sync"
	"testing"
)

func sx6Insert(t *testing.T, anchor string, order int64, message ChatAppendMessage) ChatOperation {
	t.Helper()
	return sx5Operation(t, "insert", ChatData{"beforeMessageId": anchor}, ChatData{"orderRevision": fmt.Sprint(order)}, ChatData{"messages": []ChatAppendMessage{message}})
}

func TestStoredChatSX6InsertOrderReplayAndFence(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	initial := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "synthetic input", "is_user": true}))
	anchor := initial.Changed[0]
	run := sx5Registration(c, initial.Revision, anchor)
	sx5Register(t, c, run)
	oldPage := sx5Page(t, c)
	first := ChatAppendMessage{MessageID: chatUUID(), Data: ChatData{"mes": "synthetic first", "extra": ChatData{"no_memory": true}}}
	second := ChatAppendMessage{MessageID: chatUUID(), Data: ChatData{"mes": "synthetic second"}}
	in := sx5Operations(c, sx6Insert(t, anchor.MessageID, 1, first), sx6Insert(t, anchor.MessageID, 1, second))
	saved, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, in)
	if err != nil {
		t.Fatal(err)
	}
	if saved.OrderRevision != 2 || saved.Revision != initial.Revision+1 {
		t.Fatal("insert domain versions did not advance exactly once")
	}
	replay, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, in)
	if err != nil || replay.OperationID != saved.OperationID {
		t.Fatal("insert replay was not idempotent")
	}
	page := sx5Page(t, c)
	if len(page.Items) != 3 || page.Items[0].MessageID != first.MessageID || page.Items[1].MessageID != second.MessageID || page.Items[2].MessageID != anchor.MessageID {
		t.Fatal("same-anchor inserts lost payload order")
	}
	if page.Items[2].Candidates[0].SourceRevision != anchor.Candidates[0].SourceRevision || page.Items[2].Candidates[0].CandidateID != anchor.Candidates[0].CandidateID {
		t.Fatal("insert changed existing evidence identity")
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *oldPage.BeforeCursor, View: "full"})
	expectChatCode(t, err, "CHAT_CURSOR_EXPIRED")
	changes, err := s.ListStoredChatChanges(ctx, 1, c.ChatID, initial.Revision, 50)
	if err != nil || len(changes.Items) != 1 || !changes.Items[0].OrderChanged || len(changes.Items[0].ChangedIDs) != 2 {
		t.Fatal("insert was missing from complete changes event")
	}
	// A nested Helper belongs to the same foreground operation, but its ordinary
	// insert is still an order mutation. It fences its own already-registered run.
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, sx5Terminal(c, run.RunID, "settled"))
	expectChatCode(t, err, "CHAT_GENERATION_FENCED")
	stale := sx5Operations(c, sx6Insert(t, anchor.MessageID, 1, ChatAppendMessage{MessageID: chatUUID(), Data: ChatData{"mes": "synthetic stale"}}))
	_, err = s.ApplyStoredChatOperations(ctx, 1, c.ChatID, stale)
	expectChatCode(t, err, "REVISION_CONFLICT")
	missing := sx5Operations(c, sx6Insert(t, chatUUID(), 2, first))
	_, err = s.ApplyStoredChatOperations(ctx, 1, c.ChatID, missing)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing anchor: %v", err)
	}
	forbidden := sx5Operations(c, sx6Insert(t, anchor.MessageID, 2, first))
	forbidden.Generation = &ChatGenerationCommit{RunID: run.RunID, State: "aborted"}
	_, err = s.ApplyStoredChatOperations(ctx, 1, c.ChatID, forbidden)
	expectChatCode(t, err, "CHAT_INVALID_OPERATION")
}

func TestStoredChatSX6InsertConcurrentAppendAndReorder(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	initial := sx5Append(t, c, sx5AppendRequest(c, ChatData{"mes": "synthetic anchor"}))
	anchor := initial.Changed[0].MessageID
	added := ChatAppendMessage{MessageID: chatUUID(), Data: ChatData{"mes": "synthetic inserted"}}
	tail := sx5AppendRequest(c, ChatData{"mes": "synthetic tail"})
	var failures [2]error
	var wg sync.WaitGroup
	wg.Go(func() {
		_, failures[0] = s.ApplyStoredChatOperations(ctx, 1, c.ChatID, sx5Operations(c, sx6Insert(t, anchor, 1, added)))
	})
	wg.Go(func() { _, failures[1] = s.AppendStoredMessages(ctx, 1, c.ChatID, tail) })
	wg.Wait()
	if failures[0] != nil || failures[1] != nil {
		t.Fatalf("independent append/insert: %v / %v", failures[0], failures[1])
	}
	page := sx5Page(t, c)
	if len(page.Items) != 3 || page.Items[0].MessageID != added.MessageID || page.Items[1].MessageID != anchor || page.Items[2].MessageID != tail.Messages[0].MessageID {
		t.Fatal("append/insert lost or reordered another writer's message")
	}
	next := ChatAppendMessage{MessageID: chatUUID(), Data: ChatData{"mes": "synthetic next"}}
	reorder := sx5Reorder(t, page, added.MessageID, tail.Messages[0].MessageID, tail.Messages[0].MessageID, anchor, added.MessageID)
	_, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, sx5Operations(c, reorder, sx6Insert(t, anchor, page.OrderRevision, next)))
	if err != nil {
		t.Fatal(err)
	}
	page = sx5Page(t, c)
	if len(page.Items) != 4 || page.Items[0].MessageID != tail.Messages[0].MessageID || page.Items[1].MessageID != next.MessageID || page.Items[2].MessageID != anchor || page.Items[3].MessageID != added.MessageID {
		t.Fatal("reorder/insert did not apply in command order")
	}
}
