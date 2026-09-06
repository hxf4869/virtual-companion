package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type exportTestStore struct {
	Store
	mu          sync.Mutex
	events      []string
	objectKey   string
	objectBytes int64
	jobStatus   string
	jobReason   string

	// pagination fixtures. convs is the full conversation list in ascending
	// id order; msgs maps conversation id to its full message list in id
	// order. convAfters records the exclusive id cursors the export loop
	// passed on each conversation page call.
	convs             []postgres.Conversation
	msgs              map[int64][]postgres.Message
	convCalls         int
	msgCalls          int
	convLimits        []int
	convAfters        []*int64
	msgLimits         []int
	stallConversation bool // paged conversation calls repeat the cursor row
	stallMessage      bool // paged message calls repeat the cursor row
}

func (s *exportTestStore) GetExport(context.Context, int64, int64) (postgres.Export, error) {
	return postgres.Export{ID: 9, Status: "PENDING"}, nil
}

// ListExportConversations mirrors the V130 stable export listing: rows are
// emitted in descending id order, after is an exclusive id cursor, and a
// stalled paged call repeats the cursor row. The export loop must use this
// method — the legacy mutable-activity ListConversations stays untouched for
// frontend pagination and would panic here (nil embedded Store) if called.
func (s *exportTestStore) ListExportConversations(_ context.Context, _ int64, after *int64, limit *int) ([]postgres.Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.convCalls++
	size := 50
	if limit != nil {
		size = *limit
	}
	s.convLimits = append(s.convLimits, size)
	s.convAfters = append(s.convAfters, after)
	if after != nil && s.stallConversation {
		for _, c := range s.convs {
			if c.ID == *after {
				return []postgres.Conversation{c}, nil
			}
		}
	}
	var out []postgres.Conversation
	for i := len(s.convs) - 1; i >= 0; i-- {
		c := s.convs[i]
		if after != nil && c.ID >= *after {
			continue
		}
		out = append(out, c)
		if len(out) >= size {
			break
		}
	}
	if out == nil {
		out = []postgres.Conversation{}
	}
	return out, nil
}

func (s *exportTestStore) ListMessages(_ context.Context, _, conversationID int64, after *int64, limit *int) ([]postgres.Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.msgCalls++
	size := 50
	if limit != nil {
		size = *limit
	}
	s.msgLimits = append(s.msgLimits, size)
	all := s.msgs[conversationID]
	if after != nil && s.stallMessage {
		for _, m := range all {
			if m.ID == *after {
				return []postgres.Message{m}, nil
			}
		}
	}
	start := 0
	if after != nil {
		idx := -1
		for i, m := range all {
			if m.ID == *after {
				idx = i
				break
			}
		}
		if idx < 0 {
			return []postgres.Message{}, nil
		}
		start = idx + 1
	}
	end := min(start+size, len(all))
	out := append([]postgres.Message(nil), all[start:end]...)
	if out == nil {
		out = []postgres.Message{}
	}
	return out, nil
}

func (s *exportTestStore) ListRelationships(context.Context, int64) ([]postgres.Relationship, error) {
	return []postgres.Relationship{}, nil
}

func (s *exportTestStore) RecordExportUploadIntent(_ context.Context, _, _ int64, key string, _ int) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objectKey = key
	s.events = append(s.events, "intent")
	return 1, nil
}

func (s *exportTestStore) CompleteExportObject(_ context.Context, _, _ int64, key string, objectBytes int64, _ time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if key != s.objectKey {
		return errors.New("object key changed before seal")
	}
	s.objectBytes = objectBytes
	s.events = append(s.events, "seal")
	return nil
}

func (s *exportTestStore) CompleteJob(_ context.Context, _ int64, _ int64, _, _, status, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobStatus = status
	s.jobReason = reason
	s.events = append(s.events, "job:"+status)
	return nil
}

type exportTestBlob struct {
	store          *exportTestStore
	storedBytes    int64
	plaintextBytes int64
	putErr         error
}

func (b *exportTestBlob) Put(_ context.Context, key string, data []byte) (int64, error) {
	b.store.mu.Lock()
	defer b.store.mu.Unlock()
	if key != b.store.objectKey {
		return 0, errors.New("put key differs from upload intent")
	}
	b.plaintextBytes = int64(len(data))
	b.store.events = append(b.store.events, "put")
	if b.putErr != nil {
		return 0, b.putErr
	}
	if b.storedBytes == 0 {
		b.storedBytes = b.plaintextBytes
	}
	return b.storedBytes, nil
}

func (*exportTestBlob) Delete(context.Context, string) error { return nil }

func TestExportObjectKeyMatchesV114AndAttemptsDoNotReuse(t *testing.T) {
	t.Parallel()
	reads := [][]byte{
		{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07},
		{0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f},
	}
	next := func(dst []byte) (int, error) {
		copy(dst, reads[0])
		reads = reads[1:]
		return len(dst), nil
	}
	first, err := newExportObjectKeyWithRead(42, 99, next)
	if err != nil {
		t.Fatal(err)
	}
	second, err := newExportObjectKeyWithRead(42, 99, next)
	if err != nil {
		t.Fatal(err)
	}
	shape := regexp.MustCompile(`^exports/42/99-[0-9a-f]{16}\.json$`)
	if !shape.MatchString(first) || !shape.MatchString(second) {
		t.Fatalf("unexpected keys %q %q", first, second)
	}
	if first == second {
		t.Fatalf("attempt keys were reused: %q", first)
	}
}

func TestExportRandomFailureFailsJobBeforeIntentOrPut(t *testing.T) {
	store := &exportTestStore{}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, &exportTestBlob{store: store})
	claim := postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindExport, RefID: 9, Token: "token", Fence: "fence"}
	wantErr := errors.New("random unavailable")
	err := loop.handleExportWithKey(context.Background(), claim, func(int64, int64) (string, error) {
		return "", wantErr
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error %v, want %v", err, wantErr)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.jobStatus != "FAILED" || store.jobReason != "EXPORT_KEY" {
		t.Fatalf("job status=%q reason=%q", store.jobStatus, store.jobReason)
	}
	if len(store.events) != 1 || store.events[0] != "job:FAILED" {
		t.Fatalf("events after random failure: %v", store.events)
	}
}

func TestExportObjectOrderIsIntentPutSeal(t *testing.T) {
	store := &exportTestStore{}
	blob := &exportTestBlob{store: store, storedBytes: 777}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, blob)
	claim := postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindExport, RefID: 9, Token: "token", Fence: "fence"}
	err := loop.handleExportWithKey(context.Background(), claim, func(int64, int64) (string, error) {
		return "exports/7/9-0123456789abcdef.json", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	want := []string{"intent", "put", "seal", "job:DONE"}
	if len(store.events) != len(want) {
		t.Fatalf("events %v", store.events)
	}
	for i := range want {
		if store.events[i] != want[i] {
			t.Fatalf("events %v, want %v", store.events, want)
		}
	}
	if store.objectBytes != blob.storedBytes {
		t.Fatalf("sealed object bytes=%d, want stored bytes=%d", store.objectBytes, blob.storedBytes)
	}
	if store.objectBytes == blob.plaintextBytes {
		t.Fatalf("test requires stored bytes (%d) to differ from plaintext bytes", store.objectBytes)
	}
}

func TestExportPutFailureDoesNotSeal(t *testing.T) {
	store := &exportTestStore{}
	wantErr := errors.New("put failed")
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, &exportTestBlob{store: store, putErr: wantErr})
	claim := postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindExport, RefID: 9, Token: "token", Fence: "fence"}
	err := loop.handleExportWithKey(context.Background(), claim, func(int64, int64) (string, error) {
		return "exports/7/9-0123456789abcdef.json", nil
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("error %v, want %v", err, wantErr)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	want := []string{"intent", "put", "job:FAILED"}
	if len(store.events) != len(want) {
		t.Fatalf("events %v, want %v", store.events, want)
	}
	for i := range want {
		if store.events[i] != want[i] {
			t.Fatalf("events %v, want %v", store.events, want)
		}
	}
	if store.jobReason != "EXPORT_PUT" || store.objectBytes != 0 {
		t.Fatalf("reason=%q sealed bytes=%d", store.jobReason, store.objectBytes)
	}
}

func TestExportObjectKeyRandomReadFailure(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("entropy failed")
	key, err := newExportObjectKeyWithRead(1, 2, func([]byte) (int, error) {
		return 0, wantErr
	})
	if key != "" || !errors.Is(err, wantErr) {
		t.Fatalf("key=%q error=%v", key, err)
	}
}

func decodeExportEnvelope(t *testing.T, payload []byte) exportEnvelope {
	t.Helper()
	var env exportEnvelope
	if err := json.Unmarshal(payload, &env); err != nil {
		t.Fatal(err)
	}
	return env
}

func newExportBuildLoop(store *exportTestStore) *Loop {
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, nil)
	return loop
}

func TestExportBuildPaginatesAllConversations(t *testing.T) {
	t.Parallel()
	store := &exportTestStore{msgs: map[int64][]postgres.Message{}}
	for i := int64(1); i <= 120; i++ {
		store.convs = append(store.convs, postgres.Conversation{ID: i, RelationshipID: 5})
		store.msgs[i] = []postgres.Message{{
			ID: i, Role: "user", Content: "hello",
			CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		}}
	}
	payload, err := newExportBuildLoop(store).buildExport(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	env := decodeExportEnvelope(t, payload)
	if env.ConversationCount != 120 || env.MessageCount != 120 {
		t.Fatalf("counts conversations=%d messages=%d", env.ConversationCount, env.MessageCount)
	}
	seen := map[int64]bool{}
	for _, conv := range env.Conversations {
		if seen[conv.ConversationID] {
			t.Fatalf("conversation %d exported twice", conv.ConversationID)
		}
		seen[conv.ConversationID] = true
		if len(conv.Messages) != 1 || conv.Messages[0].MessageID != conv.ConversationID {
			t.Fatalf("conversation %d messages %+v", conv.ConversationID, conv.Messages)
		}
	}
	if len(seen) != 120 {
		t.Fatalf("unique conversations %d, want 120", len(seen))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.convCalls != 2 {
		t.Fatalf("conversation list calls %d, want 2 (100 + 20)", store.convCalls)
	}
	for _, size := range store.convLimits {
		if size != exportPageSize {
			t.Fatalf("conversation page size %d, want %d", size, exportPageSize)
		}
	}
	if store.msgCalls != 120 {
		t.Fatalf("message list calls %d, want 120", store.msgCalls)
	}
}

// TestExportListsConversationsWithStableIdCursor pins audit L1: the export
// must page through vc.go_list_export_conversations (stable id keyset) instead
// of the mutable-activity frontend listing, advance the exclusive cursor
// strictly, and produce every conversation exactly once even though fixture
// ids deliberately do not correlate with any activity timestamp.
func TestExportListsConversationsWithStableIdCursor(t *testing.T) {
	t.Parallel()
	store := &exportTestStore{msgs: map[int64][]postgres.Message{}}
	for i := int64(1); i <= 205; i++ {
		store.convs = append(store.convs, postgres.Conversation{ID: i, RelationshipID: 5})
	}
	payload, err := newExportBuildLoop(store).buildExport(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	env := decodeExportEnvelope(t, payload)
	if env.ConversationCount != 205 {
		t.Fatalf("conversation count %d, want 205", env.ConversationCount)
	}
	seen := map[int64]bool{}
	for _, conv := range env.Conversations {
		if seen[conv.ConversationID] {
			t.Fatalf("conversation %d exported twice", conv.ConversationID)
		}
		seen[conv.ConversationID] = true
	}
	if len(seen) != 205 {
		t.Fatalf("unique conversations %d, want 205", len(seen))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.convCalls != 3 {
		t.Fatalf("conversation list calls %d, want 3 (100 + 100 + 5)", store.convCalls)
	}
	// The cursor is the previous page's smallest id and advances strictly
	// downward: page 1 covered 205..106, page 2 covered 105..6.
	if store.convAfters[0] != nil {
		t.Fatalf("first page cursor %v, want nil", *store.convAfters[0])
	}
	if got := *store.convAfters[1]; got != 106 {
		t.Fatalf("second page cursor %d, want 106", got)
	}
	if got := *store.convAfters[2]; got != 6 {
		t.Fatalf("third page cursor %d, want 6", got)
	}
}

func TestExportBuildPaginatesAllMessages(t *testing.T) {
	t.Parallel()
	store := &exportTestStore{msgs: map[int64][]postgres.Message{}}
	store.convs = []postgres.Conversation{{ID: 1, RelationshipID: 5}}
	for i := int64(1); i <= 250; i++ {
		store.msgs[1] = append(store.msgs[1], postgres.Message{
			ID: i, Role: "user", Content: "hello",
			CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		})
	}
	payload, err := newExportBuildLoop(store).buildExport(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	env := decodeExportEnvelope(t, payload)
	if env.ConversationCount != 1 || env.MessageCount != 250 {
		t.Fatalf("counts conversations=%d messages=%d", env.ConversationCount, env.MessageCount)
	}
	seen := map[int64]bool{}
	for _, conv := range env.Conversations {
		for _, m := range conv.Messages {
			if seen[m.MessageID] {
				t.Fatalf("message %d exported twice", m.MessageID)
			}
			seen[m.MessageID] = true
		}
	}
	if len(seen) != 250 {
		t.Fatalf("unique messages %d, want 250", len(seen))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.convCalls != 1 {
		t.Fatalf("conversation list calls %d, want 1", store.convCalls)
	}
	if store.msgCalls != 3 {
		t.Fatalf("message list calls %d, want 3 (100 + 100 + 50)", store.msgCalls)
	}
	for _, size := range store.msgLimits {
		if size != exportPageSize {
			t.Fatalf("message page size %d, want %d", size, exportPageSize)
		}
	}
}

func TestExportBuildEmptyOwnerProducesEmptyEnvelope(t *testing.T) {
	t.Parallel()
	payload, err := newExportBuildLoop(&exportTestStore{}).buildExport(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	env := decodeExportEnvelope(t, payload)
	if env.ConversationCount != 0 || len(env.Conversations) != 0 ||
		env.MessageCount != 0 || env.MemoryCount != 0 || len(env.Memories) != 0 {
		t.Fatalf("unexpected envelope %+v", env)
	}
}

func TestExportConversationCursorStallFailsWithoutSealing(t *testing.T) {
	t.Parallel()
	store := &exportTestStore{stallConversation: true, msgs: map[int64][]postgres.Message{}}
	for i := int64(1); i <= 101; i++ {
		store.convs = append(store.convs, postgres.Conversation{ID: i, RelationshipID: 5})
	}
	blob := &exportTestBlob{store: store}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, blob)
	claim := postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindExport, RefID: 9, Token: "token", Fence: "fence"}
	err := loop.handleExportWithKey(context.Background(), claim, func(int64, int64) (string, error) {
		return "exports/7/9-0123456789abcdef.json", nil
	})
	if err == nil {
		t.Fatal("expected stalled conversation cursor to fail the export")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.jobStatus != "FAILED" || store.jobReason != "EXPORT_BUILD" {
		t.Fatalf("job status=%q reason=%q", store.jobStatus, store.jobReason)
	}
	for _, ev := range store.events {
		if ev == "intent" || ev == "put" || ev == "seal" {
			t.Fatalf("stalled export must not upload, events %v", store.events)
		}
	}
	if store.objectBytes != 0 {
		t.Fatalf("stalled export sealed %d bytes", store.objectBytes)
	}
	if store.convCalls != 2 {
		t.Fatalf("conversation list calls %d, want 2", store.convCalls)
	}
}

func TestExportMessageCursorStallFailsWithoutSealing(t *testing.T) {
	t.Parallel()
	store := &exportTestStore{stallMessage: true, msgs: map[int64][]postgres.Message{}}
	store.convs = []postgres.Conversation{{ID: 1, RelationshipID: 5}}
	for i := int64(1); i <= 150; i++ {
		store.msgs[1] = append(store.msgs[1], postgres.Message{
			ID: i, Role: "user", Content: "hello",
			CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		})
	}
	blob := &exportTestBlob{store: store}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, blob)
	claim := postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindExport, RefID: 9, Token: "token", Fence: "fence"}
	err := loop.handleExportWithKey(context.Background(), claim, func(int64, int64) (string, error) {
		return "exports/7/9-0123456789abcdef.json", nil
	})
	if err == nil {
		t.Fatal("expected stalled message cursor to fail the export")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.jobStatus != "FAILED" || store.jobReason != "EXPORT_BUILD" {
		t.Fatalf("job status=%q reason=%q", store.jobStatus, store.jobReason)
	}
	for _, ev := range store.events {
		if ev == "intent" || ev == "put" || ev == "seal" {
			t.Fatalf("stalled export must not upload, events %v", store.events)
		}
	}
	if store.objectBytes != 0 {
		t.Fatalf("stalled export sealed %d bytes", store.objectBytes)
	}
}
