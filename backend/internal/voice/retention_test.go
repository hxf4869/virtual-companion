package voice

import (
	"context"
	"testing"
)

type retentionStore struct {
	*testStore
	expired, listed, completed bool
}

func (s *retentionStore) ExpireVoiceClips(context.Context) error { s.expired = true; return nil }
func (s *retentionStore) ListVoiceCleanup(context.Context) ([]CleanupObject, error) {
	s.listed = s.expired
	return []CleanupObject{{Key: "synthetic"}}, nil
}
func (s *retentionStore) CompleteVoiceCleanup(context.Context, string) error {
	s.completed = true
	return nil
}
func TestRetentionQueuesBeforeDeletingObjects(t *testing.T) {
	store := &retentionStore{testStore: &testStore{}}
	blobs := &testBlobs{}
	service := New(nil, blobs, nil, "", nil)
	service.BindStore(store)
	service.cleanup(context.Background())
	if !store.expired || !store.listed || !store.completed || blobs.deletes != 1 {
		t.Fatal("retention did not preserve the cleanup sequence")
	}
}
