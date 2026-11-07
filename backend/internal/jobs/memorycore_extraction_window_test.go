package jobs

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type extractionWindowJobStore struct {
	*recoveryEngineStore
	windowReads int
	propose     map[string]any
	replay      *engineExtractionReplay
}

func (s *concurrencyStore) ReadEngineExtractionWindow(context.Context, postgres.JobClaim, postgres.EngineOperation) ([]postgres.EngineExtractionMessage, error) {
	return nil, postgres.ErrInvalid // Concurrency fixtures only recover proposed operations.
}

func (s *extractionWindowJobStore) PrepareEngineOperation(context.Context, postgres.JobClaim) (postgres.EngineOperation, error) {
	return postgres.EngineOperation{ID: "job-8", SourceKey: "source-user", State: "NEW"}, nil
}

func (s *extractionWindowJobStore) ReadEngineExtractionWindow(context.Context, postgres.JobClaim, postgres.EngineOperation) ([]postgres.EngineExtractionMessage, error) {
	s.windowReads++
	fallback := true
	return []postgres.EngineExtractionMessage{
		{ID: "source-assistant", Role: "assistant", Content: "合成澄清"},
		{ID: "source-user", Role: "user", Content: "合成确认", Timestamp: "2026-10-21T00:00:00Z", TimestampFallback: &fallback, SourceTime: &memorytime.Result{NormalizationStatus: memorytime.StatusNone}},
	}, nil
}

func (s *extractionWindowJobStore) EngineCall(ctx context.Context, action string, in, out any) error {
	if action == "operation-status" && s.replay != nil {
		raw, err := json.Marshal(map[string]any{"status": "failed", "extractionInput": s.replay})
		if err != nil {
			return err
		}
		return json.Unmarshal(raw, out)
	}
	if action == "propose" {
		s.propose = in.(map[string]any)
		return json.Unmarshal([]byte(`{"records":[],"targets":[],"dependencies":["source-assistant","source-user"]}`), out)
	}
	return s.recoveryEngineStore.EngineCall(ctx, action, in, out)
}

func TestEngineExtractionReplaysLegacySingletonFromVerifiedMirror(t *testing.T) {
	s := &extractionWindowJobStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{}},
		replay: &engineExtractionReplay{Messages: []engineExtractionReplayMessage{{ID: "source-user", Timestamp: "2026-10-20T00:00:00Z"}}}}
	l := newExtractTestLoop(s.extractTestStore, nil)
	l.store = s
	l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
	if err := l.handleEngineExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if s.windowReads != 1 || s.propose == nil {
		t.Fatal("failed legacy operation was not replayed")
	}
	if _, present := s.propose["primarySourceId"]; present {
		t.Fatal("legacy request acquired a new primarySourceId field")
	}
	messages := s.propose["messages"].([]postgres.EngineExtractionMessage)
	if len(messages) != 1 || messages[0].Content != "合成确认" || messages[0].Role != "user" || messages[0].Timestamp != "2026-10-20T00:00:00Z" || messages[0].TimestampFallback != nil || messages[0].SourceTime != nil {
		t.Fatal("legacy singleton was expanded or did not use verified text and original timestamp")
	}
}

func TestEngineExtractionReplayRejectsChangedSupport(t *testing.T) {
	s := &extractionWindowJobStore{recoveryEngineStore: &recoveryEngineStore{extractTestStore: &extractTestStore{}}}
	_, _, err := extractionMessages(context.Background(), s, extractTestClaim(), postgres.EngineOperation{SourceKey: "source-user"},
		&engineExtractionReplay{PrimarySourceID: "source-user", Messages: []engineExtractionReplayMessage{{ID: "stale-assistant-generation"}, {ID: "source-user"}}})
	if err == nil {
		t.Fatal("stale support was reconstructed for a model call")
	}
}

func TestEngineExtractionReplayChecksMarkedTimestampAgainstVerifiedMirror(t *testing.T) {
	s := &extractionWindowJobStore{}
	claim := extractTestClaim()
	op := postgres.EngineOperation{SourceKey: "source-user"}
	real, fallback := false, true
	replay := &engineExtractionReplay{PrimarySourceID: op.SourceKey, Messages: []engineExtractionReplayMessage{{
		ID: op.SourceKey, Timestamp: "2026-10-21T00:00:00Z", TimestampFallback: &fallback, HasSourceTime: true,
	}}}
	messages, _, err := extractionMessages(context.Background(), s, claim, op, replay)
	if err != nil || len(messages) != 1 || messages[0].TimestampFallback == nil || !*messages[0].TimestampFallback || messages[0].SourceTime == nil {
		t.Fatalf("verified fallback replay: count=%d err=%v", len(messages), err)
	}
	replay.Messages[0].TimestampFallback = &real
	if _, _, err := extractionMessages(context.Background(), s, claim, op, replay); err == nil {
		t.Fatal("replay changed source time provenance")
	}
	replay.Messages[0].TimestampFallback = &fallback
	replay.Messages[0].Timestamp = "2026-10-22T00:00:00Z"
	if _, _, err := extractionMessages(context.Background(), s, claim, op, replay); err == nil {
		t.Fatal("replay replaced a verified bookkeeping timestamp")
	}
}

func TestEngineExtractionWindowOnlyLoadsForNewProposal(t *testing.T) {
	for _, status := range []string{"unknown", "proposed"} {
		t.Run(status, func(t *testing.T) {
			s := &extractionWindowJobStore{recoveryEngineStore: &recoveryEngineStore{
				extractTestStore: &extractTestStore{}, statuses: []string{status},
			}}
			l := newExtractTestLoop(s.extractTestStore, nil)
			l.store = s
			l.UseMemoryCore(memorycore.New(profilePurposeStore{}, nil))
			if err := l.handleEngineExtract(context.Background(), extractTestClaim()); err != nil {
				t.Fatal(err)
			}
			if status == "proposed" {
				if s.windowReads != 0 || s.propose != nil {
					t.Fatal("recovered proposal reloaded model context")
				}
				return
			}
			if s.windowReads != 1 || s.propose["primarySourceId"] != "source-user" {
				t.Fatalf("window reads=%d, anchor=%v", s.windowReads, s.propose["primarySourceId"])
			}
			messages, ok := s.propose["messages"].([]postgres.EngineExtractionMessage)
			if !ok || len(messages) != 2 || messages[0].Role != "assistant" || messages[1].ID != "source-user" {
				t.Fatal("verified window not passed intact")
			}
		})
	}
}
