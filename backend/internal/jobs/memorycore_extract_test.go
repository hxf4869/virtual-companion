package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type recoveryEngineStore struct {
	*extractTestStore
	calls       []string
	statuses    []string
	invalid     bool
	commitError bool
	publishes   int
	abandoned   bool
	bareStatus  bool
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
		if s.bareStatus {
			raw = `{"status":"` + v + `"}`
		}
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

type profilePurposeStore struct{}

func (profilePurposeStore) ResolvePurpose(context.Context, postgres.ResolvePurpose) (postgres.ResolvedPurpose, error) {
	return postgres.ResolvedPurpose{ProviderID: "fixture", ProviderName: "Fixture", Protocol: postgres.ProtocolOpenAIChat, Model: postgres.ProviderModel{ModelID: "fixture", MaxOutputTokens: 64, Capabilities: postgres.ModelCapabilities{"systemMessage": postgres.CapabilityVerified}}}, nil
}
func (profilePurposeStore) PrepareMemoryCoreCall(context.Context, postgres.MemoryCoreCall) (postgres.MemoryExtractPreparation, error) {
	return postgres.MemoryExtractPreparation{}, errors.New("unused")
}
func (profilePurposeStore) RecordMemoryExtractOutcome(context.Context, int64, int64, int64, postgres.MemoryExtractOutcome) (int64, error) {
	return 0, errors.New("unused")
}

type profileCodeStore struct {
	*recoveryEngineStore
	profileErr error
	onBuild    func()
}

func (s *profileCodeStore) PrepareEngineOperation(context.Context, postgres.JobClaim) (postgres.EngineOperation, error) {
	return postgres.EngineOperation{ID: "job-8", ProfileOperationID: "profile-1", State: "PUBLISHED", Proposal: json.RawMessage(`{"records":[{"id":"r1"}],"targets":[]}`)}, nil
}
func (s *profileCodeStore) BuildEngineProfile(context.Context, postgres.JobClaim, postgres.EngineOperation, string) error {
	if s.onBuild != nil {
		s.onBuild()
	}
	return s.profileErr
}
func profileFailureLog(t *testing.T, err error) string {
	t.Helper()
	var buf bytes.Buffer
	s := &profileCodeStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{retryAction: "RETRY_SCHEDULED"}}, profileErr: err}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.log = slog.New(slog.NewTextHandler(&buf, nil))
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	return buf.String()
}
func TestProfileFailureUsesClosedDecisionCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(422)
		_, _ = w.Write([]byte(`{"code":"MEMORYCORE_TOOL_PATH","detail":"secret dialogue"}`))
	}))
	defer srv.Close()
	c, err := memoryengine.New(srv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	callErr := c.Call(context.Background(), "rebuild-profile", map[string]string{}, nil)
	line := profileFailureLog(t, callErr)
	if !strings.Contains(line, "decision_code=MEMORYCORE_TOOL_PATH") || strings.Contains(line, "secret") {
		t.Fatalf("log %q", line)
	}
	plain := profileFailureLog(t, errors.New("database down"))
	if !strings.Contains(plain, "decision_code=MEMORYCORE_PROFILE") || strings.Contains(plain, "database down") {
		t.Fatalf("plain log %q", plain)
	}
	openSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(422)
		_, _ = w.Write([]byte(`{"code":"not-a-closed-code"}`))
	}))
	defer openSrv.Close()
	openClient, err := memoryengine.New(openSrv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	openErr := openClient.Call(context.Background(), "rebuild-profile", map[string]string{}, nil)
	openLog := profileFailureLog(t, openErr)
	if !strings.Contains(openLog, "decision_code=MEMORYCORE_PROFILE") || strings.Contains(openLog, "not-a-closed-code") {
		t.Fatalf("open log %q", openLog)
	}
}
func TestProfileRebuildReleasesExtractSlot(t *testing.T) {
	released := false
	sawRelease := false
	s := &profileCodeStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{}}, onBuild: func() { sawRelease = released }}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	ctx := withExtractSlotRelease(context.Background(), func() { released = true })
	if e := l.handleEngineExtract(ctx, extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	if !sawRelease {
		t.Fatal("profile rebuild held the extract slot")
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

func (s *recoveryEngineStore) AbandonEngineOperation(context.Context, postgres.JobClaim) error {
	s.abandoned = true
	return nil
}

func TestEngineFailedProposesAgainInsteadOfRevoking(t *testing.T) {
	s := &recoveryEngineStore{extractTestStore: &extractTestStore{}, statuses: []string{"failed"}, bareStatus: true}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	if s.abandoned || s.publishes != 0 || s.retryCalls != 1 || len(s.calls) != 2 || s.calls[0] != "operation-status" || s.calls[1] != "propose" {
		t.Fatalf("failed operation revoked instead of retrying propose: abandoned=%v publishes=%d retries=%d calls=%v", s.abandoned, s.publishes, s.retryCalls, s.calls)
	}
}
