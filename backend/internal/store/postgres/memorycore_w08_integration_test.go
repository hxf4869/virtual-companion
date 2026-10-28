//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func engineSampleStore(t *testing.T) (*Store, map[string]stsource.Snapshot) {
	t.Helper()
	s := resetCatalogFixtures(t)
	ctx := context.Background()
	t.Cleanup(func() { s.UseSTSourceReader(nil); s.UseMemoryEngine(nil) })
	if _, err := s.SaveProviderConfig(ctx, 7, SaveProvider{ProviderID: "prov-a", DisplayName: "Synthetic", Protocol: ProtocolOpenAIChat, BaseURL: "https://example.test/v1", Credential: "synthetic", State: ProviderEnabled, Models: []ProviderModel{catalogModel("memory", "model-a", intPtr(32768))}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SavePurposeBinding(ctx, 7, SavePurposeBinding{Purpose: PurposeMemoryExtraction, ProviderID: "prov-a", ProfileKey: "memory", State: ProviderEnabled}); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `TRUNCATE vc.embedding_config`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveEmbeddingConfig(ctx, 7, SaveEmbeddingConfig{Model: "synthetic", ArtifactVersion: "one", Dimensions: 2, QueryPreprocessingVersion: "identity-v1", DocumentPreprocessingVersion: "identity-v1", Normalization: "l2", State: "ENABLED"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	for _, k := range requiredConsents {
		if _, err := s.RecordConsent(ctx, 1, k, "test", true); err != nil {
			t.Fatal(err)
		}
	}
	snapshots := map[string]stsource.Snapshot{}
	s.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, owner int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
		if owner != 1 {
			return nil, stsource.ErrUnavailable
		}
		out := make([]stsource.Snapshot, 0, len(queries))
		for _, q := range queries {
			v, ok := snapshots[q.ChatIdentity]
			if !ok {
				return nil, stsource.ErrUnavailable
			}
			out = append(out, v)
		}
		return out, nil
	}))
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"revision":0}`)
	}))
	t.Cleanup(engine.Close)
	client, err := memoryengine.New(engine.URL, "synthetic")
	if err != nil {
		t.Fatal(err)
	}
	s.UseMemoryEngine(client)
	return s, snapshots
}

type engineSample struct {
	chat, message, candidate, text, zone, summary, recordID string
	at                                                      time.Time
	relationship                                            *int64
	targets                                                 []EngineTarget
	dependencies                                            []string
}

func publishEngineMemory(t *testing.T, s *Store, snapshots map[string]stsource.Snapshot, in engineSample) (STBinding, JobClaim, EngineOperation, Memory) {
	t.Helper()
	ctx := context.Background()
	binding, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: in.chat, CharacterRef: "engine-test", Mode: "COMPANION", RelationshipID: in.relationship})
	if err != nil {
		t.Fatalf("bind: %v", err)
	}
	snapshots[in.chat] = stsource.Snapshot{ChatIdentity: in.chat, BranchRoot: in.chat, State: "PRESENT", Revision: 1, Location: "chats/synthetic/" + in.chat + ".jsonl", Messages: []stsource.Message{{MessageID: in.message, CandidateID: in.candidate, Revision: 1, Role: "user", Text: in.text, Eligible: true, Settled: true, SourceTimestamp: &in.at, SourceTimezone: in.zone}}}
	if _, err = s.ReconcileSTSources(ctx, 1, []string{in.chat}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	jobs, err := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("claim %v %v", jobs, err)
	}
	c := jobs[0]
	op, err := s.PrepareEngineOperation(ctx, c)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	deps := []string{op.SourceKey}
	seen := map[string]bool{op.SourceKey: true}
	for _, dep := range in.dependencies {
		if !seen[dep] {
			seen[dep] = true
			deps = append(deps, dep)
		}
	}
	targets := in.targets
	if targets == nil {
		targets = []EngineTarget{}
	}
	raw, _ := json.Marshal(EngineProposal{Records: []EngineRecord{{ID: in.recordID, Content: in.summary, Version: 1}}, Targets: targets, Dependencies: deps})
	if err = s.PublishEngineProposal(ctx, c, op, raw); err != nil {
		t.Fatalf("publish: %v", err)
	}
	var id int64
	if err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT memory_id FROM vc.go_memorycore_projection($1,$2) WHERE record_id=$3 AND operation_id=$4`, 1, binding.RelationshipID, in.recordID, op.ID).Scan(&id)
	}); err != nil {
		t.Fatalf("projection %s %s: %v", in.recordID, op.ID, err)
	}
	m, err := s.GetMemory(ctx, 1, id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	return binding, c, op, m
}

func TestEngineEventDateFollowsVerifiedSource(t *testing.T) {
	s, snapshots := engineSampleStore(t)
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	_, _, _, dated := publishEngineMemory(t, s, snapshots, engineSample{
		chat: sourceChat, message: sourceMessage, candidate: sourceCandidate,
		text: "我下周五去厦门参加朋友婚礼。", zone: "Asia/Shanghai", at: at,
		summary: "用户将参加婚礼", recordID: "record-date",
	})
	if strings.Contains(dated.Summary, "周五") || strings.Contains(dated.Summary, "2026") {
		t.Fatal("summary fixture contains a date")
	}
	if dated.Time == nil || dated.Time.NormalizationStatus != memorytime.StatusNormalized || dated.Time.EventDate == nil || *dated.Time.EventDate != "2026-10-30" || dated.Time.ReminderAt != nil {
		t.Fatalf("verified source date: %+v", dated.Time)
	}
	_, _, _, missingZone := publishEngineMemory(t, s, snapshots, engineSample{
		chat: "10000000-0000-0000-0000-0000000000a1", message: sourceMessage, candidate: sourceCandidate,
		text: "我下周五去厦门参加朋友婚礼。", zone: "", at: at,
		summary: "用户将参加婚礼", recordID: "record-zone",
	})
	if missingZone.Time == nil || missingZone.Time.NormalizationStatus != memorytime.StatusNeedsClarification || missingZone.Time.EventDate != nil || missingZone.Time.ReminderAt != nil {
		t.Fatalf("missing timezone: %+v", missingZone.Time)
	}
	_, _, _, ambiguous := publishEngineMemory(t, s, snapshots, engineSample{
		chat: "10000000-0000-0000-0000-0000000000a2", message: sourceMessage, candidate: sourceCandidate,
		text: "明天晚上提醒我带书。", zone: "Asia/Shanghai", at: at,
		summary: "用户需要带书", recordID: "record-m12",
	})
	if ambiguous.Time == nil || ambiguous.Time.NormalizationStatus != memorytime.StatusNeedsClarification || ambiguous.Time.EventDate != nil || ambiguous.Time.ReminderAt != nil {
		t.Fatalf("M12 ambiguity: %+v", ambiguous.Time)
	}
}

func TestEngineCorrectionRebuildsProfileWithoutOldFact(t *testing.T) {
	s, snapshots := engineSampleStore(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	oldBinding, oldClaim, oldOp, _ := publishEngineMemory(t, s, snapshots, engineSample{
		chat: sourceChat, message: sourceMessage, candidate: sourceCandidate,
		text: "我最喜欢喝乌龙茶，每天下午都会喝一杯。", zone: "Asia/Shanghai", at: at,
		summary: "当前事实：喜欢乌龙茶", recordID: "record-old",
	})
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.go_record_memorycore_profile($1,$2,$3,$4,$5,$6)`, 1, oldClaim.JobID, oldClaim.Token, oldClaim.Fence, []string{oldOp.SourceRef}, "当前事实：喜欢乌龙茶")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteJob(ctx, 1, oldClaim.JobID, oldClaim.Token, oldClaim.Fence, "DONE", ""); err != nil {
		t.Fatal(err)
	}
	correctionChat := "10000000-0000-0000-0000-0000000000b2"
	nextBinding, nextClaim, nextOp, _ := publishEngineMemory(t, s, snapshots, engineSample{
		chat: correctionChat, message: "20000000-0000-0000-0000-0000000000b2", candidate: "30000000-0000-0000-0000-0000000000b2",
		text: "我改口了，我现在最喜欢喝茉莉花茶。", zone: "Asia/Shanghai", at: at,
		summary: "当前事实：喜欢茉莉花茶", recordID: "record-new", relationship: &oldBinding.RelationshipID,
		targets:      []EngineTarget{{ID: "record-old", Version: 1}},
		dependencies: []string{oldOp.SourceKey},
	})
	allowed := []string{}
	built, published := false, false
	var verified []string
	profile := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			AllowedRecordIDs     []string `json:"allowedRecordIds"`
			VerifiedDependencies []string `json:"verifiedDependencies"`
			Publish              bool     `json:"publish"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/operation-status":
			json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
		case "/internal/rebuild-profile":
			if input.Publish {
				published = true
				verified = append([]string(nil), input.VerifiedDependencies...)
			} else {
				built = true
				allowed = append([]string(nil), input.AllowedRecordIDs...)
			}
			json.NewEncoder(w).Encode(map[string]any{"status": "staged", "dependencies": verified})
		case "/internal/read-profile":
			facts := []string{}
			for _, id := range allowed {
				switch id {
				case "record-new":
					facts = append(facts, "当前事实：喜欢茉莉花茶")
				case "record-old":
					facts = append(facts, "当前事实：喜欢乌龙茶")
				default:
					facts = append(facts, "当前事实："+id)
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"dependencies": verified, "files": map[string]string{"persona.md": strings.Join(facts, "\n")}})
		default:
			w.WriteHeader(404)
		}
	}))
	defer profile.Close()
	client, err := memoryengine.New(profile.URL, "synthetic-profile-token")
	if err != nil {
		t.Fatal(err)
	}
	s.UseMemoryEngine(client)
	if err = s.BuildEngineProfile(ctx, nextClaim, nextOp, "synthetic-capability"); err != nil {
		t.Fatal(err)
	}
	if !built || !published {
		t.Fatal("correction did not schedule and finish a profile rebuild")
	}
	joined := strings.Join(allowed, ",")
	if !strings.Contains(joined, "record-new") || strings.Contains(joined, "record-old") {
		t.Fatalf("profile allowlist = %v", allowed)
	}
	summaries, err := s.stSummaries(ctx, 1, nextBinding.ConversationID, []stSummaryChat{{id: oldBinding.ConversationID, chat: sourceChat}, {id: nextBinding.ConversationID, chat: correctionChat}})
	if err != nil {
		t.Fatal(err)
	}
	current := make([]string, 0, len(summaries))
	for _, summary := range summaries {
		current = append(current, summary.text)
	}
	body := strings.Join(current, "\n")
	if strings.Contains(body, "乌龙茶") || !strings.Contains(body, "茉莉花茶") {
		t.Fatalf("current profile facts = %q conversation=%d", body, nextBinding.ConversationID)
	}
}
