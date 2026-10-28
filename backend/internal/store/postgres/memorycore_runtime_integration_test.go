//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEngineProjectionPublicationRecoveryAndSourceFence(t *testing.T) {
	s := resetCatalogFixtures(t)
	ctx := context.Background()
	t.Cleanup(func() { s.UseSTSourceReader(nil); s.UseMemoryEngine(nil) })
	if _, e := s.SaveProviderConfig(ctx, 7, SaveProvider{ProviderID: "prov-a", DisplayName: "Synthetic", Protocol: ProtocolOpenAIChat, BaseURL: "https://example.test/v1", Credential: "synthetic", State: ProviderEnabled, Models: []ProviderModel{catalogModel("memory", "model-a", intPtr(32768))}}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.SavePurposeBinding(ctx, 7, SavePurposeBinding{Purpose: PurposeMemoryExtraction, ProviderID: "prov-a", ProfileKey: "memory", State: ProviderEnabled}); e != nil {
		t.Fatal(e)
	}
	if e := IsolationSuperExec(ctx, `TRUNCATE vc.embedding_config`); e != nil {
		t.Fatal(e)
	}
	if _, e := s.SaveEmbeddingConfig(ctx, 7, SaveEmbeddingConfig{Model: "synthetic", ArtifactVersion: "one", Dimensions: 2, QueryPreprocessingVersion: "identity-v1", DocumentPreprocessingVersion: "identity-v1", Normalization: "l2", State: "ENABLED"}); e != nil {
		t.Fatal(e)
	}
	if _, e := s.UpdateMemoryAutoSavePref(ctx, 1, true); e != nil {
		t.Fatal(e)
	}
	for _, k := range requiredConsents {
		if _, e := s.RecordConsent(ctx, 1, k, "test", true); e != nil {
			t.Fatal(e)
		}
	}
	b, e := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "engine-test", Mode: "COMPANION"})
	if e != nil {
		t.Fatal(e)
	}
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshot := stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/synthetic/one.jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "我下周五去厦门参加婚礼", Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "Asia/Shanghai"}}}
	s.UseSTSourceReader(sourceReaderFunc(func(context.Context, int64, []stsource.Query) ([]stsource.Snapshot, error) {
		return []stsource.Snapshot{snapshot}, nil
	}))
	if _, e = s.ReconcileSTSources(ctx, 1, []string{sourceChat}); e != nil {
		t.Fatal(e)
	}
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"revision":0}`)
	}))
	defer engine.Close()
	client, e := memoryengine.New(engine.URL, "synthetic")
	if e != nil {
		t.Fatal(e)
	}
	s.UseMemoryEngine(client)
	jobs, e := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if e != nil || len(jobs) != 1 {
		t.Fatalf("jobs=%v err=%v", jobs, e)
	}
	c := jobs[0]
	op, e := s.PrepareEngineOperation(ctx, c)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(EngineProposal{Records: []EngineRecord{{ID: "record-new", Content: snapshot.Messages[0].Text, Version: 1}}, Targets: []EngineTarget{}, Dependencies: []string{op.SourceKey}})
	if _, e = s.ValidateEngineProposal(ctx, c, op, raw); e != nil {
		t.Fatal(e)
	}
	before, e := s.engineAllowed(ctx, 1, b.RelationshipID, b.ConversationID)
	if e != nil || len(before) != 0 {
		t.Fatalf("unpublished leaked %v %v", before, e)
	}
	if e = s.PublishEngineProposal(ctx, c, op, raw); e != nil {
		t.Fatal(e)
	}
	after, e := s.engineAllowed(ctx, 1, b.RelationshipID, b.ConversationID)
	if e != nil || len(after) != 1 || after[0] != "record-new" {
		t.Fatalf("publication missing %v %v", after, e)
	}
	if e = s.PublishEngineProposal(ctx, c, op, raw); e != nil {
		t.Fatal("idempotent publish", e)
	}

	recordEngineProfile(t, b.ConversationID, c.JobID, c.Token, c.Fence, []string{op.SourceRef}, "synthetic verified profile")
	if e = s.CompleteJob(ctx, 1, c.JobID, c.Token, c.Fence, "DONE", ""); e != nil {
		t.Fatal(e)
	}
	snapshot.Revision = 2
	snapshot.Messages = append(snapshot.Messages, stsource.Message{MessageID: "20000000-0000-0000-0000-000000000099", CandidateID: "30000000-0000-0000-0000-000000000099", Revision: 1, Role: "user", Text: "一个没有新事实的问题？", Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "Asia/Shanghai"})
	if _, e = s.ReconcileSTSources(ctx, 1, []string{sourceChat}); e != nil {
		t.Fatal(e)
	}
	nextJobs, e := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if e != nil || len(nextJobs) != 1 {
		t.Fatalf("empty proposal claim %v", e)
	}
	next, e := s.PrepareEngineOperation(ctx, nextJobs[0])
	if e != nil {
		t.Fatal(e)
	}
	empty, _ := json.Marshal(EngineProposal{Records: []EngineRecord{}, Targets: []EngineTarget{}, Dependencies: []string{next.SourceKey}})
	if e = s.PublishEngineProposal(ctx, nextJobs[0], next, empty); e != nil {
		t.Fatal(e)
	}
	var profiles int
	var persona string
	if e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*), COALESCE(string_agg(persona, ''), '') FROM vc.memory_profile WHERE owner_user_id=1 AND relationship_id=$1 AND valid AND btrim(persona)<>''`, b.RelationshipID).Scan(&profiles, &persona)
	}); e != nil || profiles != 1 || persona != "synthetic verified profile" {
		t.Fatalf("empty proposal invalidated valid profile: n=%d persona=%q err=%v", profiles, persona, e)
	}

	if _, e = s.SaveEmbeddingConfig(ctx, 7, SaveEmbeddingConfig{Model: "synthetic-next", ArtifactVersion: "two", Dimensions: 3, QueryPreprocessingVersion: "identity-v1", DocumentPreprocessingVersion: "identity-v1", Normalization: "l2", State: "ENABLED", ExpectedRevision: 1}); e != nil {
		t.Fatal(e)
	}
	var queueState, operationState, operationID string
	if e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT w.status,o.state,o.operation_id FROM vc.work_item w JOIN vc.memorycore_operation o ON(o.owner_user_id,o.job_id)=(w.owner_user_id,w.id) WHERE w.owner_user_id=1 AND w.id=$1`, c.JobID).Scan(&queueState, &operationState, &operationID)
	}); e != nil {
		t.Fatal(e)
	}
	if queueState != "PENDING" || operationState != "PUBLISHED" || operationID != op.ID {
		t.Fatalf("embedding change replayed extraction: %s %s", queueState, operationState)
	}
	foreign, e := s.engineProjections(ctx, 2, b.RelationshipID)
	if e != nil || len(foreign) != 0 {
		t.Fatalf("cross owner leak %v", e)
	}
	snapshot.Revision = 3
	snapshot.Messages[0].Revision = 2
	snapshot.Messages[0].Text = "我不去婚礼了"
	if _, e = s.ReconcileSTSources(ctx, 1, []string{sourceChat}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ValidateEngineProposal(ctx, c, op, raw); e == nil {
		t.Fatal("late source accepted")
	}
	after, e = s.engineAllowed(ctx, 1, b.RelationshipID, b.ConversationID)
	if e != nil || len(after) != 0 {
		t.Fatalf("invalid source remained eligible %v %v", after, e)
	}
	var revision int64
	if e = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT revision FROM vc.memorycore_scope WHERE owner_user_id=1 AND relationship_id=$1`, b.RelationshipID).Scan(&revision)
	}); e != nil || revision == 0 {
		t.Fatalf("scope fence=%d %v", revision, e)
	}
}
