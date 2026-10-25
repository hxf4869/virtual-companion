package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type cleanupStore struct {
	*memStore
	objects  []postgres.ExportObject
	clearErr error
	cleared  int
	lists    int
}

func (s *cleanupStore) ConsumeExport(context.Context, int64, int64, string) (postgres.ExportDownload, error) {
	return postgres.ExportDownload{ObjectKey: s.objects[0].ObjectKey}, nil
}

func (s *cleanupStore) ListOwnerExportObjects(context.Context, int64) ([]postgres.ExportObject, error) {
	s.lists++
	return append([]postgres.ExportObject(nil), s.objects[:min(500, len(s.objects))]...), nil
}

func (s *cleanupStore) ClearExportObject(_ context.Context, _, id int64, key string) error {
	if s.clearErr != nil {
		return s.clearErr
	}
	for i, obj := range s.objects {
		if obj.ExportID == id && obj.ObjectKey == key {
			s.objects = append(s.objects[:i], s.objects[i+1:]...)
			s.cleared++
			return nil
		}
	}
	return postgres.ErrNotFound
}

type cleanupBlob struct {
	deleteErr error
	deletes   int
}

func (b *cleanupBlob) Get(context.Context, string) ([]byte, error) { return []byte(`{}`), nil }
func (b *cleanupBlob) Delete(context.Context, string) error        { b.deletes++; return b.deleteErr }

func TestExportDownloadKeepsPointerWhenObjectDeleteFails(t *testing.T) {
	st := &cleanupStore{memStore: newMemStore(), objects: []postgres.ExportObject{{OwnerUserID: 1, ExportID: 1, ObjectKey: "synthetic-export"}}}
	s := newCoreServer(t, "full", st)
	s.core.Blobs = &cleanupBlob{deleteErr: errors.New("synthetic storage failure")}
	r := doJSON(t, s, http.MethodGet, "/api/v1/exports/1/download?token=synthetic", "", 1)
	if r.Code != 200 || st.cleared != 0 || len(st.objects) != 1 {
		t.Fatalf("download=%d clear=%d remaining=%d", r.Code, st.cleared, len(st.objects))
	}
}

func TestAccountDeleteDrainsEveryObjectBatch(t *testing.T) {
	st := &cleanupStore{memStore: newMemStore()}
	for i := 1; i <= 501; i++ {
		st.objects = append(st.objects, postgres.ExportObject{OwnerUserID: 1, ExportID: int64(i), ObjectKey: fmt.Sprintf("synthetic-%d", i)})
	}
	s := newCoreServer(t, "full", st)
	blobs := &cleanupBlob{}
	s.core.Blobs = blobs
	r := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"`+testPassword+`"}`, 1)
	if r.Code != 200 || !st.deleted || st.cleared != 501 || blobs.deletes != 501 || st.lists != 3 {
		t.Fatalf("delete=%d account=%v clear=%d objects=%d lists=%d", r.Code, st.deleted, st.cleared, blobs.deletes, st.lists)
	}
}

func TestAccountDeleteStopsWhenPointerClearFails(t *testing.T) {
	st := &cleanupStore{memStore: newMemStore(), objects: []postgres.ExportObject{{OwnerUserID: 1, ExportID: 1, ObjectKey: "synthetic-export"}}, clearErr: errors.New("synthetic persistence failure")}
	s := newCoreServer(t, "full", st)
	s.core.Blobs = &cleanupBlob{}
	r := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"`+testPassword+`"}`, 1)
	if r.Code != 503 || st.deleted || len(st.objects) != 1 {
		t.Fatalf("ambiguous cleanup allowed cascade: status=%d deleted=%v", r.Code, st.deleted)
	}
}
