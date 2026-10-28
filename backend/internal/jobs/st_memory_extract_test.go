package jobs

import (
	"context"
	"errors"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type stExtractTestStore struct {
	*extractTestStore
	purpose             postgres.ResolvedPurpose
	resolveErr          error
	resolved            []postgres.ResolvePurpose
	stReads, stPrepares int
}

func (s *stExtractTestStore) ReadSTMemoryExtractInput(_ context.Context, owner, job, source int64) (postgres.MemoryExtractInput, error) {
	s.stReads++
	return s.input, s.inputErr
}
func (s *stExtractTestStore) PrepareSTMemoryExtractAttempt(ctx context.Context, owner, job, source int64, token, fence, provider, supplier, model string, tokens int) (postgres.MemoryExtractPreparation, error) {
	s.stPrepares++
	return s.PrepareMemoryExtractAttempt(ctx, owner, job, source, token, fence, provider, supplier, model, tokens)
}
func (s *stExtractTestStore) ResolvePurpose(_ context.Context, in postgres.ResolvePurpose) (postgres.ResolvedPurpose, error) {
	s.resolved = append(s.resolved, in)
	return s.purpose, s.resolveErr
}
func stExtractFixture() (*Loop, *stExtractTestStore, *extractTestProvider, postgres.JobClaim) {
	input := extractTestInput()
	input.SourceMessageID = nil
	input.AssistantMessageID = nil
	input.SourceRef = "st:10000000-0000-0000-0000-000000000001:20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001:2:3"
	store := &stExtractTestStore{extractTestStore: &extractTestStore{input: input, pref: true}, purpose: postgres.ResolvedPurpose{ProviderID: "memory-purpose", ProviderName: "Memory", Protocol: postgres.ProtocolOpenAIChat, BaseURL: "https://example.test/v1", Credential: "synthetic-key", Model: postgres.ProviderModel{ModelID: "extract-model", MaxOutputTokens: 256}}}
	provider := &extractTestProvider{text: `[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"我喜欢安静的地方"}]`}
	loop := newExtractTestLoop(store.extractTestStore, nil)
	loop.store = store
	loop.providerFactory = func(route modelprovider.Route) (companion.Provider, error) { return provider, nil }
	claim := extractTestClaim()
	claim.Kind = KindSTMemoryExtract
	return loop, store, provider, claim
}
func TestSTExtractionUsesPurposeAndImmutableSourceWithoutGoGeneration(t *testing.T) {
	t.Parallel()
	loop, store, provider, claim := stExtractFixture()
	var route modelprovider.Route
	loop.providerFactory = func(in modelprovider.Route) (companion.Provider, error) { route = in; return provider, nil }
	if err := loop.handleMemoryExtract(context.Background(), claim); err != nil {
		t.Fatal(err)
	}
	if store.stReads != 1 || store.stPrepares != 1 || len(store.saved) != 1 || len(store.outcomes) != 1 {
		t.Fatalf("source lifecycle reads=%d prepares=%d saves=%d outcomes=%d", store.stReads, store.stPrepares, len(store.saved), len(store.outcomes))
	}
	if len(store.resolved) != 1 || store.resolved[0].Purpose != "MEMORY_EXTRACTION_DEDUP_SUMMARY" || store.resolved[0].OwnerAccountID != claim.OwnerID {
		t.Fatal("wrong purpose or owner")
	}
	if route.ProviderID != "memory-purpose" || route.ModelID != "extract-model" || route.MaxOutputTokens != 256 {
		t.Fatal("purpose did not control route and output budget")
	}
	if store.saved[0].Evidence[0] != store.input.SourceRef || store.saved[0].IdempotencyKey != "st-auto8-0" {
		t.Fatal("ST origin replaced by a fabricated Go-generation reference")
	}
}
func TestSTExtractionRefusesLateSaveAndMissingPurpose(t *testing.T) {
	t.Parallel()
	t.Run("late_source", func(t *testing.T) {
		loop, store, _, claim := stExtractFixture()
		store.saveErr = postgres.ErrInvalid
		if err := loop.handleMemoryExtract(context.Background(), claim); err != nil {
			t.Fatal(err)
		}
		if len(store.saved) != 0 || store.retryCalls != 0 || len(store.closes) != 1 || store.closes[0].reason != extractCloseSourceGuarded {
			t.Fatal("late source result was not permanently refused")
		}
	})
	t.Run("no_fallback", func(t *testing.T) {
		loop, store, provider, claim := stExtractFixture()
		store.resolveErr = errors.New("purpose disabled")
		loop.provider = provider
		if err := loop.handleMemoryExtract(context.Background(), claim); err != nil {
			t.Fatal(err)
		}
		if provider.callN != 0 || store.prepareCalls != 0 || len(store.closes) != 1 || store.closes[0].reason != "EXTRACTION_PURPOSE_UNAVAILABLE" {
			t.Fatal("unconfigured ST purpose fell back to another model")
		}
	})
	t.Run("no_silent_parameter_drop", func(t *testing.T) {
		loop, store, provider, claim := stExtractFixture()
		p := 0.4
		store.purpose.Model.GenerationParams = &postgres.GenerationParams{Temperature: &p}
		if err := loop.handleMemoryExtract(context.Background(), claim); err != nil {
			t.Fatal(err)
		}
		if provider.callN != 0 || len(store.closes) != 1 || store.closes[0].reason != "EXTRACTION_PARAMETERS_UNSUPPORTED" {
			t.Fatal("unsupported pinned parameter silently dropped")
		}
	})
}
