//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestOwnerMemoryRerankPersistsPerOwner(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	if err := IsolationSuperExec(ctx, `
INSERT INTO vc.vc_user(id, display_name) VALUES (3,'rerank-user'),(4,'rerank-disabled') ON CONFLICT DO NOTHING;
INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name) VALUES
 (1,'rerank-owner','synthetic','ADMIN','ACTIVE','owner'),
 (2,'rerank-other','synthetic','ADMIN','ACTIVE','other'),
 (3,'rerank-user','synthetic','USER','ACTIVE','user'),
 (4,'rerank-disabled','synthetic','ADMIN','DISABLED','disabled')
 ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`); err != nil {
		t.Fatal(err)
	}
	s := testEnv.store
	got, err := s.GetOwnerMemoryRerank(ctx, 1)
	if err != nil || !got.Enabled || got.Revision != 0 {
		t.Fatalf("default %+v %v", got, err)
	}
	if _, err := s.SaveOwnerMemoryRerank(ctx, 3, false, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("user save %v", err)
	}
	if _, err := s.SaveOwnerMemoryRerank(ctx, 1, false, -1); !errors.Is(err, ErrInvalid) {
		t.Fatalf("negative revision %v", err)
	}
	saved, err := s.SaveOwnerMemoryRerank(ctx, 1, false, 0)
	if err != nil || saved.Enabled || saved.Revision != 1 {
		t.Fatalf("save %+v %v", saved, err)
	}
	_, stale := s.SaveOwnerMemoryRerank(ctx, 1, true, 0)
	if stale == nil {
		t.Fatal("stale revision accepted")
	}
	var conflict *RevisionConflictError
	if !errors.As(stale, &conflict) || conflict.Current != 1 {
		t.Fatalf("conflict current=%v err=%v", conflict, stale)
	}
	other, err := s.GetOwnerMemoryRerank(ctx, 2)
	if err != nil || !other.Enabled || other.Revision != 0 {
		t.Fatalf("other owner %+v %v", other, err)
	}
	on, err := s.ResolveOwnerMemoryRerank(ctx, 1)
	if err != nil || on {
		t.Fatalf("resolve owner 1 %v %v", on, err)
	}
	def, err := s.ResolveOwnerMemoryRerank(ctx, 2)
	if err != nil || !def {
		t.Fatalf("resolve owner 2 %v %v", def, err)
	}
	if _, err := s.ResolveOwnerMemoryRerank(ctx, 4); !errors.Is(err, ErrServiceOwnerRejected) {
		t.Fatalf("disabled owner %v", err)
	}
}
