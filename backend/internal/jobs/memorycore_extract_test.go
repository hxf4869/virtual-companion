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
	calls        []string
	statuses     []string
	invalid      bool
	commitError  bool
	publishes    int
	abandoned    bool
	bareStatus   bool
	proposalBody string
	emptyCode    string
}

func (s *recoveryEngineStore) RecordEmptyExtractDecision(_ context.Context, _, _ int64, code string) error {
	s.emptyCode = code
	if strings.Contains(code, "secret") {
		return errors.New("decision carried text")
	}
	return nil
}

func (s *recoveryEngineStore) PrepareEngineOperation(context.Context, postgres.JobClaim) (postgres.EngineOperation, error) {
	return postgres.EngineOperation{ID: "job-8", State: "PROPOSED"}, nil
}
func (s *recoveryEngineStore) EngineCall(_ context.Context, action string, _ any, out any) error {
	s.calls = append(s.calls, action)
	if action == "operation-status" {
		v := s.statuses[0]
		s.statuses = s.statuses[1:]
		proposal := `{"records":[],"targets":[],"dependencies":["source-1"]}`
		if s.proposalBody != "" {
			proposal = s.proposalBody
		}
		raw := `{"status":"` + v + `","proposal":` + proposal + `}`
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
func TestEmptyPublishWritesDecisionCode(t *testing.T) {
	for _, tc := range []struct{ disp, code string }{
		{"NO_NEW_FACT", "MEMORYCORE_EMPTY_NO_NEW_FACT"},
		{"DEDUP_MERGED", "MEMORYCORE_EMPTY_DEDUP_MERGED"},
		{"DROPPED_GATE", "MEMORYCORE_EMPTY_DROPPED_GATE"},
	} {
		t.Run(tc.disp, func(t *testing.T) {
			body := `{"records":[],"targets":[],"dependencies":["source-1"],"emptyDisposition":"` + tc.disp + `","note":"secret dialogue"}`
			s := &recoveryEngineStore{extractTestStore: &extractTestStore{}, statuses: []string{"proposed"}, proposalBody: body}
			var buf bytes.Buffer
			l := newExtractTestLoop(s.extractTestStore, nil)
			l.log = slog.New(slog.NewTextHandler(&buf, nil))
			l.store = s
			l.UseMemoryCore(memorycore.New(nil, nil))
			if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
				t.Fatal(e)
			}
			line := buf.String()
			if !strings.Contains(line, "decision_code="+tc.code) || strings.Contains(line, "secret") {
				t.Fatalf("log %q", line)
			}
			if s.emptyCode != tc.code {
				t.Fatalf("attempt field %q", s.emptyCode)
			}
			closes := s.extractTestStore.closeCalls()
			if len(closes) != 1 || closes[0].status != "DONE" || closes[0].reason != "" {
				t.Fatalf("close %+v", closes)
			}
		})
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

type revisionConflictStore struct {
	*recoveryEngineStore
	rebinds      int
	proposes     int
	failProposes int
	rebindErr    error
}

func (s *revisionConflictStore) EngineCall(ctx context.Context, action string, in any, out any) error {
	if action == "propose" {
		s.proposes++
		if s.proposes <= s.failProposes {
			return memoryengine.RevisionConflictError()
		}
		return json.Unmarshal([]byte(`{"records":[{"id":"r1","content":"kept fact","version":1}],"targets":[],"dependencies":["source-1"]}`), out)
	}
	return s.recoveryEngineStore.EngineCall(ctx, action, in, out)
}
func (s *revisionConflictStore) RebindEngineOperation(context.Context, postgres.JobClaim, postgres.EngineOperation) (postgres.EngineOperation, error) {
	s.rebinds++
	if s.rebindErr != nil {
		return postgres.EngineOperation{}, s.rebindErr
	}
	return postgres.EngineOperation{ID: "job-8-r2", State: "NEW", Revision: 2, Scope: postgres.EngineOperation{}.Scope}, nil
}

func TestRevisionConflictRebindsAndReproposesInsteadOfPending(t *testing.T) {
	var buf bytes.Buffer
	s := &revisionConflictStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{}, statuses: []string{"unknown", "failed"}, bareStatus: true}, failProposes: 1}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.log = slog.New(slog.NewTextHandler(&buf, nil))
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	line := buf.String()
	if s.publishes != 1 || s.proposes != 2 || s.rebinds != 1 || s.retryCalls != 0 || strings.Contains(line, "MEMORYCORE_PENDING") {
		t.Fatalf("revision conflict dead-lettered without a rebound propose: publishes=%d proposes=%d rebinds=%d retries=%d log=%q calls=%v", s.publishes, s.proposes, s.rebinds, s.retryCalls, line, s.calls)
	}
}

func TestRevisionConflictStaysObservableWhenRebindIsExhausted(t *testing.T) {
	var buf bytes.Buffer
	s := &revisionConflictStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{retryAction: "RETRY_SCHEDULED"}, statuses: []string{"unknown", "failed", "failed", "failed"}, bareStatus: true}, failProposes: 8}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.log = slog.New(slog.NewTextHandler(&buf, nil))
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	line := buf.String()
	if !strings.Contains(line, "decision_code=MEMORYCORE_REVISION_CONFLICT") || strings.Contains(line, "MEMORYCORE_PENDING") || s.proposes > 3 || s.rebinds > 2 || s.retryCalls != 1 || s.publishes != 0 {
		t.Fatalf("unbounded or mislabeled revision conflict: proposes=%d rebinds=%d retries=%d publishes=%d log=%q", s.proposes, s.rebinds, s.retryCalls, s.publishes, line)
	}
}

type forgetProfileStore struct {
	*profileCodeStore
	prepareErr error
	forgetOp   postgres.EngineOperation
	built      int
}

func (s *forgetProfileStore) PrepareEngineOperation(context.Context, postgres.JobClaim) (postgres.EngineOperation, error) {
	return postgres.EngineOperation{}, s.prepareErr
}
func (s *forgetProfileStore) PrepareForgetProfile(context.Context, postgres.JobClaim) (postgres.EngineOperation, bool, error) {
	return s.forgetOp, true, nil
}
func (s *forgetProfileStore) BuildEngineProfile(context.Context, postgres.JobClaim, postgres.EngineOperation, string) error {
	s.built++
	return nil
}

func TestForgetProfileRebuildIgnoresSuppressedSource(t *testing.T) {
	var buf bytes.Buffer
	s := &forgetProfileStore{
		profileCodeStore: &profileCodeStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{}}},
		prepareErr:       postgres.ErrInvalid,
		forgetOp:         postgres.EngineOperation{ID: "job-8", ProfileOperationID: "forget-9-profile", State: "PUBLISHED", Revision: 2, Proposal: json.RawMessage(`{"records":[{"id":"kept"}],"targets":[]}`)},
	}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.log = slog.New(slog.NewTextHandler(&buf, nil))
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	line := buf.String()
	closes := s.closeCalls()
	if s.built != 1 || s.retryCalls != 0 || strings.Contains(line, "MEMORYCORE_SOURCE") || strings.Contains(line, "MEMORYCORE_PENDING") || len(closes) != 1 || closes[0].status != "DONE" {
		t.Fatalf("forgotten source dead-lettered the profile rebuild: built=%d retries=%d closes=%v log=%q", s.built, s.retryCalls, closes, line)
	}
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

type closedProposeStore struct {
	*recoveryEngineStore
	proposeErr error
	proposes   int
}

func (s *closedProposeStore) EngineCall(ctx context.Context, action string, in any, out any) error {
	if action == "propose" {
		s.proposes++
		return s.proposeErr
	}
	return s.recoveryEngineStore.EngineCall(ctx, action, in, out)
}

func TestProposeClosedEngineCodeIsRecordedInsteadOfPending(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(422)
		_, _ = w.Write([]byte(`{"code":"MEMORYCORE_ENGINE_DEDUP_INVALID","detail":"secret dialogue"}`))
	}))
	defer srv.Close()
	client, err := memoryengine.New(srv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	proposeErr := client.Call(context.Background(), "propose", map[string]string{}, nil)
	if memoryengine.ClosedCode(proposeErr) != "MEMORYCORE_ENGINE_DEDUP_INVALID" {
		t.Fatalf("transport code %q err %v", memoryengine.ClosedCode(proposeErr), proposeErr)
	}
	var buf bytes.Buffer
	s := &closedProposeStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{retryAction: "RETRY_SCHEDULED"}, statuses: []string{"unknown", "failed"}, bareStatus: true}, proposeErr: proposeErr}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.log = slog.New(slog.NewTextHandler(&buf, nil))
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	line := buf.String()
	closes := s.closeCalls()
	if !strings.Contains(line, "decision_code=MEMORYCORE_ENGINE_DEDUP_INVALID") || strings.Contains(line, "MEMORYCORE_PENDING") || strings.Contains(line, "secret") || strings.Contains(line, "dead_lettered") || s.proposes != 1 || s.publishes != 0 || s.retryCalls != 0 || len(closes) != 1 || closes[0].status != "FAILED" || closes[0].reason != "MEMORYCORE_ENGINE_DEDUP_INVALID" {
		t.Fatalf("closed propose code collapsed: proposes=%d publishes=%d retries=%d closes=%v calls=%v log=%q", s.proposes, s.publishes, s.retryCalls, closes, s.calls, line)
	}
}

func TestProposeWithoutClosedCodeIsPendingOnlyWhilePreparing(t *testing.T) {
	var buf bytes.Buffer
	s := &closedProposeStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{retryAction: "RETRY_SCHEDULED"}, statuses: []string{"failed", "failed"}, bareStatus: true}, proposeErr: errors.New("timeout")}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.log = slog.New(slog.NewTextHandler(&buf, nil))
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	line := buf.String()
	if !strings.Contains(line, "decision_code=MEMORYCORE_OPERATION_FAILED") || strings.Contains(line, "MEMORYCORE_PENDING") || strings.Contains(line, "timeout") || s.retryCalls != 1 || s.publishes != 0 {
		t.Fatalf("empty failed proposal labeled pending: retries=%d publishes=%d log=%q calls=%v", s.retryCalls, s.publishes, line, s.calls)
	}
	preparing := &recoveryEngineStore{extractTestStore: &extractTestStore{retryAction: "RETRY_SCHEDULED"}, statuses: []string{"preparing"}}
	buf.Reset()
	l = newExtractTestLoop(preparing.extractTestStore, nil)
	l.log = slog.New(slog.NewTextHandler(&buf, nil))
	l.store = preparing
	l.UseMemoryCore(memorycore.New(nil, nil))
	if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(buf.String(), "decision_code=MEMORYCORE_PENDING") || preparing.retryCalls != 1 || len(preparing.calls) != 1 {
		t.Fatalf("preparing lost: retries=%d calls=%v log=%q", preparing.retryCalls, preparing.calls, buf.String())
	}
}

func TestAdmissionRefusalClosesWithoutRetry(t *testing.T) {
	for _, tc := range []struct {
		code, status string
	}{
		{"MEMORYCORE_CONSENT_WITHDRAWN", "DONE"},
		{"MEMORYCORE_CLAIM_LOST", "FAILED"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(422)
				_, _ = w.Write([]byte(`{"code":"` + tc.code + `"}`))
			}))
			defer srv.Close()
			client, err := memoryengine.New(srv.URL, "private")
			if err != nil {
				t.Fatal(err)
			}
			proposeErr := client.Call(context.Background(), "propose", map[string]string{}, nil)
			var buf bytes.Buffer
			s := &closedProposeStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{retryAction: "RETRY_SCHEDULED"}, statuses: []string{"unknown"}, bareStatus: true}, proposeErr: proposeErr}
			l := newExtractTestLoop(s.extractTestStore, nil)
			l.log = slog.New(slog.NewTextHandler(&buf, nil))
			l.store = s
			l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
			if e := l.handleEngineExtract(context.Background(), extractTestClaim()); e != nil {
				t.Fatal(e)
			}
			closes := s.closeCalls()
			line := buf.String()
			if s.retryCalls != 0 || s.proposes != 1 || len(closes) != 1 || closes[0].status != tc.status || closes[0].reason != tc.code || !strings.Contains(line, "decision_code="+tc.code) || strings.Contains(line, "requeued") || strings.Contains(line, "dead_lettered") {
				t.Fatalf("admission refusal retried: retries=%d proposes=%d closes=%v log=%q", s.retryCalls, s.proposes, closes, line)
			}
		})
	}
}
