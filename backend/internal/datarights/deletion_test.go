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
