//go:build integration

package postgres

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func syntheticMessageID(position int) string {
	return fmt.Sprintf("10000000-0000-4000-8000-%012x", position)
}
func syntheticCandidateID(position int) string {
	return fmt.Sprintf("20000000-0000-4000-8000-%012x", position)
}
func seedStoredHistory(t *testing.T, c StoredChat, count int) {
	t.Helper()
	ctx := context.Background()
	s := testEnv.store
	conn, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	common, err := s.encodeChatJSON(ChatData{"name": "Synthetic", "is_user": true, "unknown": ChatData{"kept": true}})
	if err != nil {
		t.Fatal(err)
	}
	messages := make([][]any, 0, count)
	candidates := make([][]any, 0, count+1)
	for i := 1; i <= count; i++ {
		text := fmt.Sprintf("synthetic message %d", i)
		if i == 1 || i == count-1 {
			text += " Needle"
		}
		data, err := s.encodeChatJSON(ChatData{"mes": text, "extra": ChatData{"extension": "kept"}, "variables": ChatData{"value": i}})
		if err != nil {
			t.Fatal(err)
		}
		messages = append(messages, []any{int64(1), c.ChatID, syntheticMessageID(i), int64(i), syntheticCandidateID(i), common, []byte{1}})
		candidates = append(candidates, []any{int64(1), c.ChatID, syntheticMessageID(i), syntheticCandidateID(i), int32(0), data, []byte{1}})
	}
	alternate, err := s.encodeChatJSON(ChatData{"mes": "unselected archive marker", "extra": ChatData{"unknown-swipe": true}})
	if err != nil {
		t.Fatal(err)
	}
	candidates = append(candidates, []any{int64(1), c.ChatID, syntheticMessageID(count), syntheticCandidateID(count + 1), int32(1), alternate, []byte{1}})
	if _, err = tx.CopyFrom(ctx, pgx.Identifier{"vc", "stored_message"}, []string{"owner_user_id", "chat_id", "message_id", "position", "selected_candidate_id", "data_cipher", "initial_digest"}, pgx.CopyFromRows(messages)); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.CopyFrom(ctx, pgx.Identifier{"vc", "stored_candidate"}, []string{"owner_user_id", "chat_id", "message_id", "candidate_id", "ordinal", "data_cipher", "initial_digest"}, pgx.CopyFromRows(candidates)); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE vc.stored_chat SET message_count=$2,next_position=$2 WHERE owner_user_id=1 AND chat_id=$1`, c.ChatID, count); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}
func TestStoredChatPagingTwentyThousand(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 20000)
	ctx := context.Background()
	s := testEnv.store
	tail, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{IncludeChat: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(tail.Items) != 50 || tail.Items[0].MessageID != syntheticMessageID(19951) || tail.Items[49].MessageID != syntheticMessageID(20000) || !tail.HasOlder || tail.HasNewer || tail.Chat == nil || tail.Chat.MessageCount != 20000 {
		t.Fatal("tail/include=chat contract failed")
	}
	if len(tail.Items[49].Candidates) != 1 || tail.Items[49].CandidateCount != 2 {
		t.Fatal("display leaked or lost candidate count")
	}
	if _, ok := tail.Items[0].Data["variables"]; ok {
		t.Fatal("display contains full variables")
	}
	seen := map[string]bool{}
	cursor := ""
	times := []time.Duration{}
	maxBytes := 0
	for {
		started := time.Now()
		page, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: cursor, Limit: 200})
		times = append(times, time.Since(started))
		if err != nil {
			t.Fatal(err)
		}
		wire, _ := json.Marshal(page)
		if len(wire) > maxBytes {
			maxBytes = len(wire)
		}
		if len(page.Items) == 0 {
			t.Fatal("unexpected empty nonterminal page")
		}
		for i, m := range page.Items {
			if seen[m.MessageID] {
				t.Fatal("duplicate backward message")
			}
			seen[m.MessageID] = true
			if i > 0 {
				a := page.Items[i-1].MessageID
				if a >= m.MessageID {
					t.Fatal("page is not ascending")
				}
			}
		}
		if !page.HasOlder {
			break
		}
		cursor = *page.BeforeCursor
	}
	if len(seen) != 20000 {
		t.Fatalf("backward count=%d", len(seen))
	}
	anchor, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{AnchorMessageID: syntheticMessageID(1), Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	if len(anchor.Items) != 1 || anchor.HasOlder || !anchor.HasNewer {
		t.Fatal("first anchor contract failed")
	}
	forwardSeen := map[string]bool{anchor.Items[0].MessageID: true}
	cursor = *anchor.AfterCursor
	for {
		page, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{After: cursor, Limit: 200})
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range page.Items {
			if forwardSeen[m.MessageID] {
				t.Fatal("duplicate forward message")
			}
			forwardSeen[m.MessageID] = true
		}
		if !page.HasNewer {
			break
		}
		cursor = *page.AfterCursor
	}
	if len(forwardSeen) != 20000 {
		t.Fatalf("forward count=%d", len(forwardSeen))
	}
	full, err := s.GetStoredMessage(ctx, 1, c.ChatID, syntheticMessageID(20000))
	if err != nil {
		t.Fatal(err)
	}
	if full.View != "full" || len(full.Candidates) != 2 || full.Data["unknown"] == nil || full.Data["variables"] == nil || full.Candidates[1].Data["mes"] != "unselected archive marker" {
		t.Fatal("full message lost compatibility fields")
	}
	// The first match lies outside the latest 50-message display window.
	matches, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: "  nEedle  ", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(matches.Items) != 1 || matches.Items[0].MessageID != syntheticMessageID(19999) || !matches.HasOlder || matches.HasNewer {
		t.Fatal("full-chat selected-text search failed")
	}
	older, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: "needle", Before: *matches.BeforeCursor, Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(older.Items) != 1 || older.Items[0].MessageID != syntheticMessageID(1) || older.HasOlder || !older.HasNewer {
		t.Fatal("search page missed old history")
	}
	empty, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: "archive"})
	if err != nil {
		t.Fatal(err)
	}
	if len(empty.Items) != 0 || empty.BeforeCursor != nil || empty.AfterCursor != nil || empty.HasOlder || empty.HasNewer {
		t.Fatal("search included a deselected candidate")
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: "needle", AnchorMessageID: syntheticMessageID(50)})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("nonmatching anchor=%v", err)
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	t.Logf("synthetic rows=20000 backward_pages=%d page_max_bytes=%d store_page_p50=%s store_page_p95=%s", len(times), maxBytes, times[len(times)/2], times[(len(times)*95-1)/100])
	if maxBytes > storedChatPageBytes {
		t.Fatalf("small-message display page exceeds soft byte target: %d", maxBytes)
	}
}

func expiredStoredCursor(t *testing.T, s *Store, token string) string {
	t.Helper()
	c, err := s.decodeChatCursor(token)
	if err != nil {
		t.Fatal(err)
	}
	c.Expires = time.Now().Add(-time.Second).Unix()
	data, _ := json.Marshal(c)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("vc-chat-keyset-v1\x00"))
	mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func TestStoredChatReadFencesAndChanges(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 5)
	ctx := context.Background()
	s := testEnv.store
	page, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *page.BeforeCursor, View: "full"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("view scope=%v", err)
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *page.BeforeCursor, Q: "other"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("query scope=%v", err)
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: "forged." + *page.BeforeCursor})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("forged cursor=%v", err)
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: expiredStoredCursor(t, s, *page.BeforeCursor)})
	expectChatCode(t, err, "CHAT_CURSOR_EXPIRED")
	_, err = s.ListStoredMessages(ctx, 2, c.ChatID, ChatMessageQuery{Before: *page.BeforeCursor})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign chat=%v", err)
	}
	// Ordinary deletion leaves orderRevision valid and cannot reappear in an old page.
	if err = IsolationSuperExec(ctx, `DELETE FROM vc.stored_message WHERE owner_user_id=1 AND chat_id=$1 AND message_id=$2`, c.ChatID, syntheticMessageID(2)); err != nil {
		t.Fatal(err)
	}
	older, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *page.BeforeCursor})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range older.Items {
		if m.MessageID == syntheticMessageID(2) {
			t.Fatal("old cursor resurrected deletion")
		}
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.stored_chat SET order_revision=2,revision=2 WHERE owner_user_id=1 AND chat_id=$1`, c.ChatID); err != nil {
		t.Fatal(err)
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *page.BeforeCursor})
	expectChatCode(t, err, "CHAT_CURSOR_EXPIRED")
	anchor, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{AnchorMessageID: syntheticMessageID(3), Limit: 2})
	if err != nil || len(anchor.Items) != 2 || anchor.Items[1].MessageID != syntheticMessageID(3) {
		t.Fatalf("anchor recovery: %v", err)
	}
	event := ChatChange{OperationID: chatUUID(), Revision: 2, MetadataRevision: 1, OrderRevision: 2, AuthorityEpoch: 2, ChangedIDs: []string{}, DeletedIDs: []string{syntheticMessageID(2)}, OrderChanged: true}
	eventJSON, _ := json.Marshal(event)
	if err = IsolationSuperExec(ctx, `INSERT INTO vc.chat_change(owner_user_id,chat_id,revision,event)VALUES(1,$1,2,$2)`, c.ChatID, eventJSON); err != nil {
		t.Fatal(err)
	}
	changes, err := s.ListStoredChatChanges(ctx, 1, c.ChatID, 0, 1)
	if err != nil || len(changes.Items) != 1 || !changes.HasMore || changes.ThroughRevision != 1 || changes.CurrentRevision != 2 {
		t.Fatalf("changes page: %v", err)
	}
	changes, err = s.ListStoredChatChanges(ctx, 1, c.ChatID, 1, 1)
	if err != nil || len(changes.Items) != 1 || changes.HasMore || changes.ThroughRevision != 2 || !changes.Items[0].OrderChanged {
		t.Fatalf("changes second: %v", err)
	}
	_, err = s.ListStoredChatChanges(ctx, 1, c.ChatID, 3, 50)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("future changes=%v", err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.chat_change SET created_at=now()-interval '8 days' WHERE owner_user_id=1 AND chat_id=$1 AND revision=1`, c.ChatID); err != nil {
		t.Fatal(err)
	}
	_, err = s.ListStoredChatChanges(ctx, 1, c.ChatID, 0, 50)
	expectChatCode(t, err, "CHAT_CHANGES_EXPIRED")
	if err = IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET epoch=3 WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *anchor.BeforeCursor})
	expectChatCode(t, err, "CHAT_CURSOR_EXPIRED")
	if _, err = s.WipeAllChats(ctx, 1); err != nil {
		t.Fatal(err)
	}
	_, err = s.GetStoredMessage(ctx, 1, c.ChatID, syntheticMessageID(1))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted chat message=%v", err)
	}
	_, err = s.ListStoredChatChanges(ctx, 1, c.ChatID, 2, 50)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted changes=%v", err)
	}
}

func TestStoredChatListAndFullPageBytes(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 3)
	ctx := context.Background()
	s := testEnv.store
	// A single oversized display page still returns the complete message, never a truncated field.
	large := strings.Repeat("synthetic-large-", 22000)
	encrypted, err := s.encodeChatJSON(ChatData{"mes": large})
	if err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.stored_candidate SET data_cipher=$3 WHERE owner_user_id=1 AND chat_id=$1 AND candidate_id=$2`, c.ChatID, syntheticCandidateID(3), encrypted); err != nil {
		t.Fatal(err)
	}
	page, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{View: "full", Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Data["mes"] != large || !page.HasOlder || page.HasNewer {
		t.Fatal("byte stop truncated a message or lost continuation")
	}
	next, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{View: "full", Before: *page.BeforeCursor})
	if err != nil || len(next.Items) != 2 {
		t.Fatalf("byte page continuation: %v", err)
	}
	other := "other"
	_, err = s.CreateStoredChat(ctx, 1, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &other, Title: "Second"})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := s.ListStoredChats(ctx, 1, ChatListQuery{Limit: 1})
	if err != nil || len(listed.Items) != 1 || listed.NextCursor == nil {
		t.Fatalf("list: %v", err)
	}
	last, err := s.ListStoredChats(ctx, 1, ChatListQuery{Cursor: *listed.NextCursor, Limit: 1})
	if err != nil || len(last.Items) != 1 || last.Items[0].ChatID == listed.Items[0].ChatID || last.NextCursor != nil {
		t.Fatalf("list cursor: %v", err)
	}
	foreign, err := s.ListStoredChats(ctx, 2, ChatListQuery{})
	if err != nil || len(foreign.Items) != 0 || foreign.AuthorityEpoch != 2 || foreign.NextCursor != nil {
		t.Fatalf("empty list fence: %v", err)
	}
	_, err = s.ListStoredChats(ctx, 2, ChatListQuery{Cursor: *listed.NextCursor})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("foreign list cursor: %v", err)
	}
	_, err = s.ListStoredChats(ctx, 1, ChatListQuery{Cursor: *listed.NextCursor, Q: "synthetic"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("list filter scope: %v", err)
	}
	found, err := s.ListStoredChats(ctx, 1, ChatListQuery{Q: "second"})
	if err != nil || len(found.Items) != 1 || found.Items[0].Title != "Second" {
		t.Fatalf("title search: %v", err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='ST' WHERE owner_user_id=2`); err != nil {
		t.Fatal(err)
	}
	_, err = s.ListStoredChats(ctx, 2, ChatListQuery{})
	expectChatCode(t, err, "SCHEMA_UNAVAILABLE")
}

func TestStoredChatReadSerializesConcurrentEditDeleteReorder(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 4)
	ctx := context.Background()
	s := testEnv.store
	before, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	readDone := make(chan error, 1)
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	go func() {
		readDone <- s.withStoredChatRead(ctx, 1, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
			if _, err := s.readStoredChat(ctx, tx, 1, c.ChatID, epoch); err != nil {
				return err
			}
			close(entered)
			<-release
			m, err := s.loadStoredMessage(ctx, tx, 1, c.ChatID, syntheticMessageID(1))
			if err != nil {
				return err
			}
			if m.Candidates[0].Data["mes"] != "synthetic message 1 Needle" {
				return errors.New("read observed partially concurrent state")
			}
			return nil
		})
	}()
	select {
	case <-entered:
	case err := <-readDone:
		t.Fatalf("read did not enter: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("read lock timeout")
	}
	writer, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close(ctx)
	tx, err := writer.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err = s.bindOwner(ctx, tx, 1); err != nil {
		t.Fatal(err)
	}
	edited, err := s.encodeChatJSON(ChatData{"mes": "synthetic edited"})
	if err != nil {
		t.Fatal(err)
	}
	writeDone := make(chan error, 1)
	go func() {
		_, _, err := lockChatAuthority(ctx, tx, 1, true)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE vc.stored_candidate SET data_cipher=$3 WHERE owner_user_id=1 AND chat_id=$1 AND candidate_id=$2`, c.ChatID, syntheticCandidateID(1), edited)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vc.stored_message WHERE owner_user_id=1 AND chat_id=$1 AND message_id=$2`, c.ChatID, syntheticMessageID(2))
		}
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE vc.stored_message SET position=4-position WHERE owner_user_id=1 AND chat_id=$1 AND position IN(1,3)`, c.ChatID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE vc.stored_chat SET revision=2,order_revision=2,message_count=3 WHERE owner_user_id=1 AND chat_id=$1`, c.ChatID)
		}
		if err == nil {
			err = storeChatChange(ctx, tx, 1, c.ChatID, ChatChange{OperationID: chatUUID(), Revision: 2, MetadataRevision: 1, OrderRevision: 2, AuthorityEpoch: 2, ChangedIDs: []string{syntheticMessageID(1), syntheticMessageID(3)}, DeletedIDs: []string{syntheticMessageID(2)}, OrderChanged: true})
		}
		if err == nil {
			err = tx.Commit(ctx)
		}
		writeDone <- err
	}()
	blocked := false
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err = s.pool.QueryRow(ctx, `SELECT cardinality(pg_blocking_pids($1))>0`, writer.PgConn().PID()).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("concurrent mutation did not wait for the coherent read")
	}
	close(release)
	released = true
	if err = <-readDone; err != nil {
		t.Fatal(err)
	}
	if err = <-writeDone; err != nil {
		t.Fatal(err)
	}
	after, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Items) != 3 || after.Items[0].MessageID != syntheticMessageID(3) || after.Items[1].MessageID != syntheticMessageID(1) || after.Items[1].Data["mes"] != "synthetic edited" || after.OrderRevision != 2 {
		t.Fatal("next read did not observe the complete concurrent transaction")
	}
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Before: *before.BeforeCursor})
	expectChatCode(t, err, "CHAT_CURSOR_EXPIRED")
}

func TestStoredChatUnicodeSearchCandidateTimesAndWireBudget(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 3)
	ctx := context.Background()
	s := testEnv.store
	for i := 1; i <= 2; i++ {
		encrypted, err := s.encodeChatJSON(ChatData{"mes": strings.Repeat("x", 50<<10)})
		if err != nil {
			t.Fatal(err)
		}
		if err = IsolationSuperExec(ctx, `UPDATE vc.stored_candidate SET data_cipher=$3 WHERE owner_user_id=1 AND chat_id=$1 AND candidate_id=$2`, c.ChatID, syntheticCandidateID(i), encrypted); err != nil {
			t.Fatal(err)
		}
	}
	chosen := ChatData{"mes": "ος Straße", "send_date": "2026-11-07T10:00:00Z", "gen_started": "2026-11-07T09:59:58Z", "gen_finished": "2026-11-07T10:00:00Z"}
	encrypted, err := s.encodeChatJSON(chosen)
	if err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.stored_candidate SET data_cipher=$3 WHERE owner_user_id=1 AND chat_id=$1 AND candidate_id=$2`, c.ChatID, syntheticCandidateID(3), encrypted); err != nil {
		t.Fatal(err)
	}
	old, err := s.encodeChatJSON(ChatData{"send_date": "2025-01-01T00:00:00Z", "gen_started": "old", "gen_finished": "old", "unknown": true})
	if err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.stored_message SET data_cipher=$3 WHERE owner_user_id=1 AND chat_id=$1 AND message_id=$2`, c.ChatID, syntheticMessageID(3), old); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"ΟΣ STRASSE", "straße"} {
		page, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: q})
		if err != nil || len(page.Items) != 1 || page.Items[0].MessageID != syntheticMessageID(3) {
			t.Fatalf("Unicode search: count=%d err=%v", len(page.Items), err)
		}
		if page.Items[0].Data["send_date"] != chosen["send_date"] {
			t.Fatal("display has unselected candidate time")
		}
	}
	page, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{View: "full", Limit: 200})
	if err != nil {
		t.Fatal(err)
	}
	wire, _ := json.Marshal(page)
	if len(page.Items) != 2 || page.Items[0].MessageID != syntheticMessageID(2) || len(wire) > storedChatPageBytes || !page.HasOlder {
		t.Fatalf("wire byte budget: items=%d bytes=%d", len(page.Items), len(wire))
	}
	full := page.Items[1]
	for _, key := range []string{"send_date", "gen_started", "gen_finished"} {
		if full.Data[key] != chosen[key] || full.Candidates[0].Data[key] != chosen[key] {
			t.Fatal("full candidate time projection disagrees")
		}
	}
	if full.Data["unknown"] != true {
		t.Fatal("full lost shared extension")
	}
	next, err := s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{View: "full", Before: *page.BeforeCursor})
	if err != nil || len(next.Items) != 1 || next.Items[0].MessageID != syntheticMessageID(1) {
		t.Fatalf("byte budget continuation: %v", err)
	}
}

func TestStoredChatChangesRejectsExpiredLatestEvent(t *testing.T) {
	c := storedChatFixture(t)
	ctx := context.Background()
	s := testEnv.store
	event := ChatChange{OperationID: chatUUID(), Revision: 2, MetadataRevision: 1, OrderRevision: 1, AuthorityEpoch: 2, ChangedIDs: []string{}, DeletedIDs: []string{}}
	wire, _ := json.Marshal(event)
	if err := IsolationSuperExec(ctx, `UPDATE vc.stored_chat SET revision=2 WHERE owner_user_id=1 AND chat_id=$1`, c.ChatID); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.chat_change(owner_user_id,chat_id,revision,event,created_at) VALUES(1,$1,2,$2,now()-interval '8 days')`, c.ChatID, wire); err != nil {
		t.Fatal(err)
	}
	_, err := s.ListStoredChatChanges(ctx, 1, c.ChatID, 0, 50)
	expectChatCode(t, err, "CHAT_CHANGES_EXPIRED")
}
