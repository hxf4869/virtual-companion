package jobs

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type chatImportTestStore struct {
	Store
	mu                         sync.Mutex
	pendingCalls, processCalls int
	cleanupLimit               int
	entered                    chan struct{}
	proceed                    chan struct{}
	transient                  bool
}

func (s *chatImportTestStore) PendingChatImports(context.Context, int) ([]postgres.ChatImportWork, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pendingCalls++
	return []postgres.ChatImportWork{{Owner: 1, ImportID: "synthetic-private-import"}}, nil
}
func (s *chatImportTestStore) ProcessChatImport(ctx context.Context, owner int64, id string, _ chattransfer.Objects) error {
	s.mu.Lock()
	s.processCalls++
	if owner != 1 || id != "synthetic-private-import" {
		s.mu.Unlock()
		return errors.New("wrong work")
	}
	transient := s.transient
	s.mu.Unlock()
	s.entered <- struct{}{}
	select {
	case <-s.proceed:
	case <-ctx.Done():
		return ctx.Err()
	}
	if transient {
		return errors.New("synthetic storage unavailable")
	}
	return nil
}
func (s *chatImportTestStore) CleanupChatTransfers(_ context.Context, _ chattransfer.Objects, limit int) (int, error) {
	s.cleanupLimit = limit
	return 0, errors.New("synthetic object storage unavailable")
}

type chatImportTestObjects struct{ BlobStore }

func (*chatImportTestObjects) GetLimited(context.Context, string, int64) ([]byte, error) {
	return nil, nil
}
func (*chatImportTestObjects) ListKeys(context.Context, string, string, int) ([]string, error) {
	return nil, nil
}

func TestChatImportWorkerSlotNeverBlocksOtherClaimsAndReleasesAfterTransientError(t *testing.T) {
	store := &chatImportTestStore{entered: make(chan struct{}, 2), proceed: make(chan struct{}), transient: true}
	l := NewLoop(nil, Policy{}, companion.TurnBudget{})
	l.Use(store, nil, &chatImportTestObjects{})
	if n := l.ClaimChatImportOnce(t.Context()); n != 1 {
		t.Fatalf("claimed=%d", n)
	}
	<-store.entered
	if !l.claimMu.TryLock() {
		t.Fatal("chat import held the model job claim mutex")
	}
	l.claimMu.Unlock()
	if n := l.ClaimChatImportOnce(t.Context()); n != 0 {
		t.Fatal("busy worker accepted another preparation")
	}
	store.mu.Lock()
	if store.pendingCalls != 1 {
		t.Fatal("busy import repeatedly queried pending jobs")
	}
	store.mu.Unlock()
	close(store.proceed)
	l.handlers.Wait()
	if n := l.ClaimChatImportOnce(t.Context()); n != 1 {
		t.Fatal("transient failure kept local slot forever")
	}
	<-store.entered
	l.handlers.Wait()
}

func TestChatImportCancelledPreparationJoinsWorkerShutdown(t *testing.T) {
	store := &chatImportTestStore{entered: make(chan struct{}, 1), proceed: make(chan struct{})}
	l := NewLoop(nil, Policy{}, companion.TurnBudget{})
	l.Use(store, nil, &chatImportTestObjects{})
	ctx, cancel := context.WithCancel(t.Context())
	if l.ClaimChatImportOnce(ctx) != 1 {
		t.Fatal("work not handed off")
	}
	<-store.entered
	cancel()
	if err := l.Stop(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(l.importSlots) != 0 {
		t.Fatal("cancelled import leaked worker slot")
	}
}

func TestChatTransferCleanupUsesExistingSchedulerBound(t *testing.T) {
	store := &chatImportTestStore{}
	l := NewLoop(nil, Policy{}, companion.TurnBudget{})
	l.Use(store, nil, &chatImportTestObjects{})
	l.cleanupChatTransfers(t.Context())
	if store.cleanupLimit != 256 {
		t.Fatalf("cleanup bound=%d", store.cleanupLimit)
	}
}
