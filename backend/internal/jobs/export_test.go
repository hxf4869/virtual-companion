package jobs

import (
	"context"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type exportTestStore struct {
	Store
	mu        sync.Mutex
	events    []string
	objectKey string
	jobStatus string
	jobReason string
}

func (s *exportTestStore) GetExport(context.Context, int64, int64) (postgres.Export, error) {
	return postgres.Export{ID: 9, Status: "PENDING"}, nil
}

func (s *exportTestStore) ListConversations(context.Context, int64, *int64, *int64, *int) ([]postgres.Conversation, error) {
	return []postgres.Conversation{}, nil
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

func (s *exportTestStore) CompleteExportObject(_ context.Context, _, _ int64, key string, _ int64, _ time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if key != s.objectKey {
		return errors.New("object key changed before seal")
	}
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
	store *exportTestStore
}

func (b *exportTestBlob) Put(_ context.Context, key string, _ []byte) error {
	b.store.mu.Lock()
	defer b.store.mu.Unlock()
	if key != b.store.objectKey {
		return errors.New("put key differs from upload intent")
	}
	b.store.events = append(b.store.events, "put")
	return nil
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
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, &exportTestBlob{store: store})
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
