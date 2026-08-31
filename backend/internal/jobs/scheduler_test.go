package jobs

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type schedulerTestStore struct {
	Store
	mu            sync.Mutex
	objects       []postgres.ExportObject
	clearCalls    int
	clearFailures int
}

func (s *schedulerTestStore) PurgeExpiredOpaqueSessions(context.Context) (int, error) {
	return 0, nil
}

func (s *schedulerTestStore) ExpireStaleExports(context.Context) (int, error) {
	return 0, nil
}

func (s *schedulerTestStore) ListExpiredExportObjects(context.Context) ([]postgres.ExportObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]postgres.ExportObject(nil), s.objects...), nil
}

func (s *schedulerTestStore) ClearExportObject(_ context.Context, owner, exportID int64, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clearCalls++
	if s.clearFailures > 0 {
		s.clearFailures--
		return errors.New("clear failed")
	}
	for i, object := range s.objects {
		if object.OwnerUserID == owner && object.ExportID == exportID && object.ObjectKey == key {
			s.objects = append(s.objects[:i], s.objects[i+1:]...)
			break
		}
	}
	return nil
}

func (*schedulerTestStore) RunRetentionCategory(context.Context, string, bool) error {
	return nil
}

func (*schedulerTestStore) ListExpiredGenerationJobs(context.Context, int) ([]postgres.JobClaim, error) {
	return []postgres.JobClaim{}, nil
}

func (*schedulerTestStore) ExpireQueuedGenerations(context.Context, time.Duration) (int, error) {
	return 0, nil
}

type schedulerTestBlob struct {
	mu          sync.Mutex
	deleteCalls int
	deleteErr   error
}

func (*schedulerTestBlob) Put(_ context.Context, _ string, data []byte) (int64, error) {
	return int64(len(data)), nil
}

func (b *schedulerTestBlob) Delete(context.Context, string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.deleteCalls++
	return b.deleteErr
}

func newSchedulerTestStore() *schedulerTestStore {
	return &schedulerTestStore{objects: []postgres.ExportObject{{
		OwnerUserID: 1,
		ExportID:    2,
		ObjectKey:   "exports/1/2-0123456789abcdef.json",
	}}}
}

func runSchedulerOnce(t *testing.T, store *schedulerTestStore, blob BlobStore) {
	t.Helper()
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, blob)
	if err := NewScheduler(loop).RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestSchedulerKeepsPointerWithoutBlobStore(t *testing.T) {
	store := newSchedulerTestStore()
	runSchedulerOnce(t, store, nil)
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.clearCalls != 0 || len(store.objects) != 1 {
		t.Fatalf("clear calls=%d objects=%v", store.clearCalls, store.objects)
	}
}

func TestSchedulerKeepsPointerWhenDeleteFails(t *testing.T) {
	store := newSchedulerTestStore()
	blob := &schedulerTestBlob{deleteErr: errors.New("delete failed")}
	runSchedulerOnce(t, store, blob)
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.clearCalls != 0 || len(store.objects) != 1 {
		t.Fatalf("clear calls=%d objects=%v", store.clearCalls, store.objects)
	}
	blob.mu.Lock()
	defer blob.mu.Unlock()
	if blob.deleteCalls != 1 {
		t.Fatalf("delete calls=%d", blob.deleteCalls)
	}
}

func TestSchedulerClearsPointerOnlyAfterDeleteSucceeds(t *testing.T) {
	store := newSchedulerTestStore()
	blob := &schedulerTestBlob{}
	runSchedulerOnce(t, store, blob)
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.clearCalls != 1 || len(store.objects) != 0 {
		t.Fatalf("clear calls=%d objects=%v", store.clearCalls, store.objects)
	}
	blob.mu.Lock()
	defer blob.mu.Unlock()
	if blob.deleteCalls != 1 {
		t.Fatalf("delete calls=%d", blob.deleteCalls)
	}
}

func TestSchedulerRetriesAfterClearFailure(t *testing.T) {
	store := newSchedulerTestStore()
	store.clearFailures = 1
	blob := &schedulerTestBlob{}
	runSchedulerOnce(t, store, blob)
	runSchedulerOnce(t, store, blob)
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.clearCalls != 2 || len(store.objects) != 0 {
		t.Fatalf("clear calls=%d objects=%v", store.clearCalls, store.objects)
	}
	blob.mu.Lock()
	defer blob.mu.Unlock()
	if blob.deleteCalls != 2 {
		t.Fatalf("delete calls=%d", blob.deleteCalls)
	}
}
