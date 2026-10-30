package jobs

import (
	"testing"

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
