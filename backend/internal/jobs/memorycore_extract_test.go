package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"testing"
)

type recoveryEngineStore struct {
	*extractTestStore
	calls       []string
	statuses    []string
	invalid     bool
	commitError bool
	publishes   int
}

func (s *recoveryEngineStore) PrepareEngineOperation(context.Context, postgres.JobClaim) (postgres.EngineOperation, error) {
	return postgres.EngineOperation{ID: "job-8", State: "PROPOSED"}, nil
}
func (s *recoveryEngineStore) EngineCall(_ context.Context, action string, _ any, out any) error {
	s.calls = append(s.calls, action)
	if action == "operation-status" {
		v := s.statuses[0]
		s.statuses = s.statuses[1:]
		raw := `{"status":"` + v + `","proposal":{"records":[],"targets":[],"dependencies":["source-1"]}}`
		return json.Unmarshal([]byte(raw), out)
	}
	if action == "commit" && s.commitError {
		return errors.New("timeout")
	}
	return nil
}
func (s *recoveryEngineStore) ValidateEngineProposal(context.Context, postgres.JobClaim, postgres.EngineOperation, json.RawMessage) ([]string, error) {
	if s.invalid {
		return nil, postgres.ErrConflict
	}
	return []string{"source"}, nil
}
func (s *recoveryEngineStore) PublishEngineProposal(context.Context, postgres.JobClaim, postgres.EngineOperation, json.RawMessage) error {
	s.publishes++
	return nil
}
func TestEngineCommitTimeoutChecksStatusBeforePublishing(t *testing.T) {
	s := &recoveryEngineStore{extractTestStore: &extractTestStore{}, statuses: []string{"proposed", "published"}, commitError: true}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.store = s
	l.UseMemoryCore(memorycore.New(nil, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	if s.publishes != 1 || len(s.calls) != 3 || s.calls[2] != "operation-status" {
		t.Fatalf("calls=%v published=%d", s.calls, s.publishes)
	}
	for _, a := range s.calls {
		if a == "propose" {
			t.Fatal("replayed model extraction")
		}
	}
}
func TestEngineUnpublishedLateResultNeverPublishes(t *testing.T) {
	s := &recoveryEngineStore{extractTestStore: &extractTestStore{}, statuses: []string{"published"}, invalid: true}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.store = s
	l.UseMemoryCore(memorycore.New(nil, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	if s.publishes != 0 || len(s.calls) != 1 {
		t.Fatalf("late publication: %v", s.calls)
	}
}
func TestEnginePreparingDoesNotResubmit(t *testing.T) {
	s := &recoveryEngineStore{extractTestStore: &extractTestStore{}, statuses: []string{"preparing"}}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.store = s
	l.UseMemoryCore(memorycore.New(nil, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	if s.publishes != 0 || len(s.calls) != 1 || s.retryCalls != 1 {
		t.Fatal("preparing operation was replayed")
	}
}
