package jobs

import (
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/proactive"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

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
