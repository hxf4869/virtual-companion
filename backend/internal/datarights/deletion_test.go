package datarights

import (
	"context"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"testing"
)

type deletionFixture struct {
	engineDone bool
	engineErr  error
	deleted    bool
	calls      []string
}

func (f *deletionFixture) ClearSTAccountData(context.Context, int64) (bool, error) {
	f.calls = append(f.calls, "ST")
	return true, nil
}
func (f *deletionFixture) ClearMemoryCoreAccountData(context.Context, int64) (bool, error) {
	f.calls = append(f.calls, "MEMORYCORE")
	return f.engineDone, f.engineErr
}
func (f *deletionFixture) ListOwnerExportObjects(context.Context, int64) ([]postgres.ExportObject, error) {
	return nil, nil
}
func (f *deletionFixture) ClearExportObject(context.Context, int64, int64, string) error { return nil }
func (f *deletionFixture) DeleteAccount(context.Context, int64) error                    { f.deleted = true; return nil }
func TestDeletionWaitsForMemoryCoreAndResumesSameIntent(t *testing.T) {
	f := &deletionFixture{engineErr: errors.New("unavailable")}
	p, err := ContinueDeletion(context.Background(), 7, f, nil)
	if err == nil || p.Status != "PENDING" || len(p.PendingDomains) != 1 || p.PendingDomains[0] != "MEMORYCORE" || f.deleted {
		t.Fatalf("pending=%+v err=%v deleted=%v", p, err, f.deleted)
	}
	f.engineErr = nil
	p, err = ContinueDeletion(context.Background(), 7, f, nil)
	if err != nil || p.Status != "PENDING" || f.deleted {
		t.Fatalf("partial=%+v err=%v", p, err)
	}
	f.engineDone = true
	p, err = ContinueDeletion(context.Background(), 7, f, nil)
	if err != nil || p.Status != "COMPLETED" || !f.deleted {
		t.Fatalf("completed=%+v err=%v", p, err)
	}
}

type deletionDomainStore struct {
	*deletionFixture
	notificationDone  bool
	inboxDone         bool
	notificationCalls int
	inboxCalls        int
}

func (d *deletionDomainStore) ClearNotificationDomain(context.Context, int64) (bool, error) {
	d.notificationCalls++
	return d.notificationDone, nil
}

func (d *deletionDomainStore) ClearInboxDomain(context.Context, int64) (bool, error) {
	d.inboxCalls++
	return d.inboxDone, nil
}

func TestDeletionNamesNotificationBeforeInbox(t *testing.T) {
	base := &deletionFixture{engineDone: true}
	store := &deletionDomainStore{deletionFixture: base}
	p, err := ContinueDeletion(context.Background(), 7, store, nil)
	if err != nil || p.Status != "PENDING" || len(p.PendingDomains) != 1 || p.PendingDomains[0] != "NOTIFICATION" || store.inboxCalls != 0 || base.deleted {
		t.Fatalf("notification pending=%+v err=%v inbox=%d deleted=%v", p, err, store.inboxCalls, base.deleted)
	}
	store.notificationDone = true
	p, err = ContinueDeletion(context.Background(), 7, store, nil)
	if err != nil || p.Status != "PENDING" || p.PendingDomains[0] != "INBOX" || store.inboxCalls != 1 || base.deleted {
		t.Fatalf("inbox pending=%+v err=%v", p, err)
	}
	store.inboxDone = true
	p, err = ContinueDeletion(context.Background(), 7, store, nil)
	if err != nil || p.Status != "COMPLETED" || !base.deleted {
		t.Fatalf("completed=%+v err=%v deleted=%v", p, err, base.deleted)
	}
}

type voiceDeletionFixture struct {
	*deletionFixture
	voiceDone bool
}

func (f *voiceDeletionFixture) ClearVoiceAccountData(context.Context, int64) (bool, error) {
	return f.voiceDone, nil
}
func TestDeletionWaitsForVoiceObjectCleanup(t *testing.T) {
	f := &voiceDeletionFixture{deletionFixture: &deletionFixture{engineDone: true}}
	progress, err := ContinueDeletion(context.Background(), 7, f, nil)
	if err != nil || progress.Status != "PENDING" || len(progress.PendingDomains) != 1 || progress.PendingDomains[0] != "VOICE" || f.deleted {
		t.Fatal("account completed while audio cleanup was pending")
	}
	f.voiceDone = true
	progress, err = ContinueDeletion(context.Background(), 7, f, nil)
	if err != nil || progress.Status != "COMPLETED" || !f.deleted {
		t.Fatal("account did not finish after voice cleanup")
	}
}
