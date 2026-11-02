package jobs

import (
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/proactive"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestOpenProactiveRouteReasoningFloor(t *testing.T) {
	effort := "max"
	base := postgres.ResolvedPurpose{ProviderID: "p", ProviderName: "p", Protocol: "OPENAI_CHAT_COMPLETIONS", BaseURL: "https://example.invalid"}
	base.Model.ModelID = "m"
	base.Model.MaxOutputTokens = 393216

	plain, err := openProactiveRoute(base, 64)
	if err != nil || plain.MaxOutputTokens != 64 || plain.ReasoningEffort != nil {
		t.Fatalf("non-reasoning route = %+v, %v", plain, err)
	}

	reasoning := base
	reasoning.Model.GenerationParams = &postgres.GenerationParams{ReasoningEffort: &effort}
	got, err := openProactiveRoute(reasoning, 64)
	if err != nil || got.MaxOutputTokens != 4096 || got.ReasoningEffort == nil || *got.ReasoningEffort != "max" {
		t.Fatalf("reasoning route = %+v, %v", got, err)
	}

	small := reasoning
	small.Model.MaxOutputTokens = 2048
	got, _ = openProactiveRoute(small, 64)
	if got.MaxOutputTokens != 2048 {
		t.Fatalf("floor must not exceed the model limit: %d", got.MaxOutputTokens)
	}
}

func TestJudgmentRouteForcesLowTemperature(t *testing.T) {
	temp := 0.3
	top := 0.9
	route, err := judgmentRoute(postgres.ResolvedPurpose{
		ProviderID: "vc03m-chat", ProviderName: "fixture", Protocol: postgres.ProtocolOpenAIChat,
		BaseURL: "http://127.0.0.1:9/v1",
		Model: postgres.ProviderModel{
			ModelID: "vc03m-chat", MaxOutputTokens: 256,
			GenerationParams: &postgres.GenerationParams{Temperature: &temp, TopP: &top},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if route.Temperature == nil || *route.Temperature != proactive.JudgmentTemperature || route.TopP != nil || route.MaxOutputTokens != 64 {
		t.Fatalf("route = %+v", route)
	}
}

func TestProactiveFailureDoesNotReleasePossiblySentUsage(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"dial not sent", companion.Disconnected(companion.DeliveryNotSent), "NOT_SENT"},
		{"timeout after send", companion.Timeout(companion.TimeoutTotal, companion.DeliveryUnknown), "UNKNOWN"},
		{"malformed response received", companion.Malformed(companion.DeliveryReceived), "UNKNOWN"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			kind, in, out, cached := followUsageSettlement(companion.Usage{InputTokens: 20, OutputTokens: 5}, tc.err)
			if kind != tc.want || in != nil || out != nil || cached != nil {
				t.Fatalf("failed call settlement = %s, %v, %v, %v; want %s without partial usage", kind, in, out, cached, tc.want)
			}
		})
	}
}
