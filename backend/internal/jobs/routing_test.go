package jobs

import (
	"context"
	"sync"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

type routingStore struct {
	*concurrencyStore
	routes   []postgres.ProviderRoute
	prepared []turn.PrepareAttempt
	mu       sync.Mutex
}

func (s *routingStore) ResolveProviderRoutes(context.Context) ([]postgres.ProviderRoute, error) {
	return append([]postgres.ProviderRoute(nil), s.routes...), nil
}

func (s *routingStore) PrepareAttempt(ctx context.Context, in turn.PrepareAttempt) (turn.PreparedAttempt, error) {
	s.mu.Lock()
	s.prepared = append(s.prepared, in)
	s.mu.Unlock()
	return s.concurrencyStore.PrepareAttempt(ctx, in)
}

type routeProvider struct {
	err   error
	text  string
	calls int
}

func (p *routeProvider) Stream(_ context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.calls++
	if p.err != nil {
		return companion.AttemptResult{}, p.err
	}
	if err := emit(companion.OutputDelta{Text: p.text}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{
		Finish: companion.FinishStop,
		Usage:  companion.Usage{InputTokens: 2, OutputTokens: 2, TotalTokens: 4},
	}, nil
}

func TestGenerationFallsBackToNextFrozenRouteOnlyWhenNotSent(t *testing.T) {
	base := newConcurrencyStore(1)
	store := &routingStore{concurrencyStore: base, routes: []postgres.ProviderRoute{
		{ProviderID: "primary", SupplierName: "Primary", Protocol: postgres.ProtocolOpenAIChat, BaseURL: "https://primary.example/v1", Credential: "key-a", ModelID: "model-a", MaxOutputTokens: 100, Priority: 1},
		{ProviderID: "backup", SupplierName: "Backup", Protocol: postgres.ProtocolAnthropic, BaseURL: "https://backup.example/v1", Credential: "key-b", ModelID: "model-b", MaxOutputTokens: 100, Priority: 2},
	}}
	primary := &routeProvider{err: companion.Disconnected(companion.DeliveryNotSent)}
	backup := &routeProvider{text: "我在。"}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.budget.MaxAttempts = 2
	loop.Use(store, nil, nil, nil)
	loop.UseProviderFactory(func(route modelprovider.Route) (companion.Provider, error) {
		if route.ProviderID == "primary" {
			return primary, nil
		}
		return backup, nil
	})
	claim := base.claims[0]
	if err := loop.handleGeneration(context.Background(), claim, "routing-test"); err != nil {
		t.Fatal(err)
	}
	if primary.calls != 1 || backup.calls != 1 {
		t.Fatalf("calls primary=%d backup=%d", primary.calls, backup.calls)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.prepared) != 2 || store.prepared[0].ProviderID != "primary" ||
		store.prepared[1].ProviderID != "backup" || store.prepared[1].ModelID != "model-b" {
		t.Fatalf("prepared routes %+v", store.prepared)
	}
}

func TestGenerationDoesNotFallbackWhenDeliveryIsUnknown(t *testing.T) {
	base := newConcurrencyStore(1)
	store := &routingStore{concurrencyStore: base, routes: []postgres.ProviderRoute{
		{ProviderID: "primary", SupplierName: "Primary", Protocol: postgres.ProtocolOpenAIChat, BaseURL: "https://primary.example/v1", Credential: "key-a", ModelID: "model-a", MaxOutputTokens: 100, Priority: 1},
		{ProviderID: "backup", SupplierName: "Backup", Protocol: postgres.ProtocolAnthropic, BaseURL: "https://backup.example/v1", Credential: "key-b", ModelID: "model-b", MaxOutputTokens: 100, Priority: 2},
	}}
	primary := &routeProvider{err: companion.Disconnected(companion.DeliveryUnknown)}
	backup := &routeProvider{text: "不应调用"}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.budget.MaxAttempts = 2
	loop.Use(store, nil, nil, nil)
	loop.UseProviderFactory(func(route modelprovider.Route) (companion.Provider, error) {
		if route.ProviderID == "primary" {
			return primary, nil
		}
		return backup, nil
	})
	if err := loop.handleGeneration(context.Background(), base.claims[0], "routing-test"); err != nil {
		t.Fatal(err)
	}
	if primary.calls != 1 || backup.calls != 0 {
		t.Fatalf("calls primary=%d backup=%d", primary.calls, backup.calls)
	}
}

func TestGenerationDoesNotReplayTheOnlyConfiguredRoute(t *testing.T) {
	base := newConcurrencyStore(1)
	store := &routingStore{concurrencyStore: base, routes: []postgres.ProviderRoute{
		{ProviderID: "only", SupplierName: "Only", Protocol: postgres.ProtocolOpenAIResponses, BaseURL: "https://only.example/v1", Credential: "key", ModelID: "model", MaxOutputTokens: 100, Priority: 1},
	}}
	only := &routeProvider{err: companion.Timeout(companion.TimeoutConnect, companion.DeliveryNotSent)}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.budget.MaxAttempts = 2
	loop.Use(store, nil, nil, nil)
	loop.UseProviderFactory(func(modelprovider.Route) (companion.Provider, error) { return only, nil })
	if err := loop.handleGeneration(context.Background(), base.claims[0], "routing-test"); err != nil {
		t.Fatal(err)
	}
	if only.calls != 1 {
		t.Fatalf("only route was called %d times", only.calls)
	}
	if phase := base.mem.Phase("1"); phase != companion.PhaseFailed {
		t.Fatalf("phase %s", phase)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.prepared) != 1 {
		t.Fatalf("prepared attempts %+v", store.prepared)
	}
}

func TestGenerationTerminalizesAfterBackupFailure(t *testing.T) {
	base := newConcurrencyStore(1)
	store := &routingStore{concurrencyStore: base, routes: []postgres.ProviderRoute{
		{ProviderID: "primary", SupplierName: "Primary", Protocol: postgres.ProtocolOpenAIChat, BaseURL: "https://primary.example/v1", Credential: "key-a", ModelID: "model-a", MaxOutputTokens: 100, Priority: 1},
		{ProviderID: "backup", SupplierName: "Backup", Protocol: postgres.ProtocolAnthropic, BaseURL: "https://backup.example/v1", Credential: "key-b", ModelID: "model-b", MaxOutputTokens: 100, Priority: 2},
	}}
	primary := &routeProvider{err: companion.Timeout(companion.TimeoutConnect, companion.DeliveryNotSent)}
	backup := &routeProvider{err: companion.Timeout(companion.TimeoutConnect, companion.DeliveryNotSent)}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.budget.MaxAttempts = 2
	loop.Use(store, nil, nil, nil)
	loop.UseProviderFactory(func(route modelprovider.Route) (companion.Provider, error) {
		if route.ProviderID == "primary" {
			return primary, nil
		}
		return backup, nil
	})
	if err := loop.handleGeneration(context.Background(), base.claims[0], "routing-test"); err != nil {
		t.Fatal(err)
	}
	if primary.calls != 1 || backup.calls != 1 || base.mem.Phase("1") != companion.PhaseFailed {
		t.Fatalf("calls primary=%d backup=%d phase=%s", primary.calls, backup.calls, base.mem.Phase("1"))
	}
}
