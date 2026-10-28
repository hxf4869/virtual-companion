package memorycore

import (
	"context"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"testing"
	"time"
)

type fakeStore struct {
	purpose            *postgres.ResolvedPurpose
	prepared, recorded int
	denied             bool
	outcomes           []postgres.MemoryExtractOutcome
}

func (s *fakeStore) ResolvePurpose(context.Context, postgres.ResolvePurpose) (postgres.ResolvedPurpose, error) {
	if s.purpose != nil {
		return *s.purpose, nil
	}
	return postgres.ResolvedPurpose{ProviderID: "fixture", ProviderName: "Fixture", Protocol: postgres.ProtocolOpenAIChat, Model: postgres.ProviderModel{ModelID: "fixture", MaxOutputTokens: 64, Capabilities: postgres.ModelCapabilities{"systemMessage": postgres.CapabilityVerified}}}, nil
}
func (s *fakeStore) PrepareMemoryCoreCall(_ context.Context, in postgres.MemoryCoreCall) (postgres.MemoryExtractPreparation, error) {
	if s.denied {
		return postgres.MemoryExtractPreparation{}, postgres.ErrConflict
	}
	s.prepared++
	return postgres.MemoryExtractPreparation{AttemptID: int64(s.prepared), Decision: "EXTRACTABLE"}, nil
}
func (s *fakeStore) RecordMemoryExtractOutcome(_ context.Context, _, _, _ int64, out postgres.MemoryExtractOutcome) (int64, error) {
	s.recorded++
	s.outcomes = append(s.outcomes, out)
	return 1, nil
}

type fakeProvider struct {
	calls   int
	failure bool
}

func (p *fakeProvider) Stream(_ context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.calls++
	if p.failure {
		return companion.AttemptResult{}, companion.Timeout(companion.TimeoutTotal, companion.DeliveryUnknown)
	}
	_ = emit(companion.OutputDelta{Text: "synthetic"})
	return companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{InputTokens: 4, OutputTokens: 2, TotalTokens: 6}}, nil
}
func TestCallbackCapabilityAndPerCallAccounting(t *testing.T) {
	st := &fakeStore{}
	p := &fakeProvider{}
	b := New(st, func(modelprovider.Route) (companion.Provider, error) { return p, nil })
	token, err := b.Open(context.Background(), Scope{Owner: 1, Job: 2, Source: 3, ClaimToken: "lease", ClaimFence: "fence", OperationID: "op", ExpiresAt: time.Now().Add(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	req := Request{OperationToken: token, Stage: "l1-extraction", CallSequence: 1, Messages: []Message{{Role: "user", Content: "synthetic"}}}
	bad := req
	bad.OperationToken = "invalid"
	if _, err = b.Call(context.Background(), bad); err == nil {
		t.Fatal("unknown capability accepted")
	}
	bad = req
	bad.Stage = "network"
	if _, err = b.Call(context.Background(), bad); err == nil {
		t.Fatal("unknown stage accepted")
	}
	for i := 1; i <= 2; i++ {
		req.CallSequence = i
		out, err := b.Call(context.Background(), req)
		if err != nil || out.Text != "synthetic" {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if p.calls != 2 || st.prepared != 2 || st.recorded != 2 {
		t.Fatal("not accounted per call")
	}
	if _, err = b.Call(context.Background(), req); !errors.Is(err, ErrReplay) {
		t.Fatalf("replay not refused: %v", err)
	}
	req.CallSequence = 3
	st.denied = true
	if _, err = b.Call(context.Background(), req); err == nil {
		t.Fatal("admission ignored")
	}
	if p.calls != 2 {
		t.Fatal("call after refused admission")
	}
	b.Revoke(token)
	req.CallSequence = 4
	if _, err = b.Call(context.Background(), req); err == nil {
		t.Fatal("revoked capability accepted")
	}
}
func TestCallbackFailureRecordedWithoutBody(t *testing.T) {
	st := &fakeStore{}
	p := &fakeProvider{failure: true}
	b := New(st, func(modelprovider.Route) (companion.Provider, error) { return p, nil })
	token, _ := b.Open(context.Background(), Scope{Owner: 1, Job: 2, Source: 3, ClaimToken: "lease", ClaimFence: "fence", OperationID: "op", ExpiresAt: time.Now().Add(time.Minute)})
	_, err := b.Call(context.Background(), Request{OperationToken: token, Stage: "l2-scene", CallSequence: 1, Messages: []Message{{Role: "user", Content: "synthetic"}}})
	if err == nil || st.recorded != 1 || st.outcomes[0].InputTokens != nil || st.outcomes[0].OutputPayload != "" {
		t.Fatal("failure accounting invalid")
	}
}

func TestModelParameterCapabilityRefusals(t *testing.T) {
	effort, temperature, topP := "low", 0.2, 0.8
	p := postgres.ResolvedPurpose{Protocol: postgres.ProtocolOpenAIChat, Model: postgres.ProviderModel{MaxOutputTokens: 64, GenerationParams: &postgres.GenerationParams{ReasoningEffort: &effort}}}
	if _, err := route(p); !errors.Is(err, ErrParameters) {
		t.Fatal("undeclared reasoning level accepted")
	}
	p.Model.ReasoningLevels = []string{"low"}
	if _, err := route(p); err != nil {
		t.Fatal(err)
	}
	p.Model.Capabilities = postgres.ModelCapabilities{"temperature": postgres.CapabilityDeclared, "topP": postgres.CapabilityDeclared}
	p.Protocol = postgres.ProtocolAnthropic
	if _, err := route(p); !errors.Is(err, ErrParameters) {
		t.Fatal("unsupported Anthropic reasoning mapping accepted")
	}
	p.Model.GenerationParams = &postgres.GenerationParams{Temperature: &temperature, TopP: &topP}
	if _, err := route(p); !errors.Is(err, ErrParameters) {
		t.Fatal("mutually exclusive Anthropic sampling parameters accepted")
	}
	temperature = 1.5
	p.Model.GenerationParams = &postgres.GenerationParams{Temperature: &temperature}
	if _, err := route(p); !errors.Is(err, ErrParameters) {
		t.Fatal("Anthropic temperature above supported range accepted")
	}
}

func TestSamplingCapabilityBeforeBudgetAndNetwork(t *testing.T) {
	for _, key := range []string{"temperature", "topP"} {
		for _, status := range []string{"", postgres.CapabilityUnknown, postgres.CapabilityUnsupported, postgres.CapabilityDeclared, postgres.CapabilityVerified} {
			t.Run(key+"/"+status, func(t *testing.T) {
				value := 0.5
				params := &postgres.GenerationParams{}
				if key == "temperature" {
					params.Temperature = &value
				} else {
					params.TopP = &value
				}
				purpose := postgres.ResolvedPurpose{ProviderID: "fixture", Protocol: postgres.ProtocolOpenAIChat, Model: postgres.ProviderModel{MaxOutputTokens: 64, GenerationParams: params, Capabilities: postgres.ModelCapabilities{key: status}}}
				st := &fakeStore{purpose: &purpose}
				p := &fakeProvider{}
				built := 0
				broker := New(st, func(modelprovider.Route) (companion.Provider, error) { built++; return p, nil })
				scope := Scope{Owner: 1, Job: 2, Source: 3, ClaimToken: "lease", ClaimFence: "fence", OperationID: "op", ExpiresAt: time.Now().Add(time.Minute)}
				token, err := broker.Open(context.Background(), scope)
				supported := status == postgres.CapabilityDeclared || status == postgres.CapabilityVerified
				if !supported {
					if !errors.Is(err, ErrParameters) || built != 0 || st.prepared != 0 || p.calls != 0 {
						t.Fatal("unsupported parameter crossed admission boundary")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				// Refusal is repeated on each resolved snapshot, before reserving cost.
				purpose.Model.Capabilities[key] = postgres.CapabilityUnsupported
				_, err = broker.Call(context.Background(), Request{OperationToken: token, Stage: "l1-extraction", CallSequence: 1, Messages: []Message{{Role: "user", Content: "synthetic"}}})
				if !errors.Is(err, ErrParameters) || built != 0 || st.prepared != 0 || p.calls != 0 {
					t.Fatal("changed parameter capability crossed admission boundary")
				}
				purpose.Model.Capabilities[key] = status
				if _, err = broker.Call(context.Background(), Request{OperationToken: token, Stage: "l1-extraction", CallSequence: 1, Messages: []Message{{Role: "user", Content: "synthetic"}}}); err != nil {
					t.Fatal(err)
				}
				if built != 1 || st.prepared != 1 || p.calls != 1 {
					t.Fatal("supported declared parameter not executed")
				}
			})
		}
	}
}
