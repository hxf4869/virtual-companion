package httpapi

import (
	"reflect"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// N-06: 快照 JSON 必须暴露本轮 source 用户消息 ID（终态失败后的显式再尝试
// 用它复用已持久化的原消息），协议缺失时不出现该字段。
func TestGenerationSnapshotJSONExposesSourceMessageID(t *testing.T) {
	t.Parallel()
	src := int64(90)
	got := generationSnapshotJSONFrom(postgres.GenerationSnapshot{
		Status:          "FAILED_FINAL",
		SourceMessageID: &src,
	})
	if got.SourceMessageID == nil || *got.SourceMessageID != "90" {
		t.Fatalf("sourceUserMessageId = %v, want 90", got.SourceMessageID)
	}

	plain := generationSnapshotJSONFrom(postgres.GenerationSnapshot{Status: "QUEUED"})
	if plain.SourceMessageID != nil {
		t.Fatalf("sourceUserMessageId = %v, want nil", plain.SourceMessageID)
	}
}

func TestGenerationSnapshotEventsExposeDurableTerminal(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		status      string
		text        string
		failureCode string
		want        []map[string]any
	}{
		{"queued", "QUEUED", "", "", []map[string]any{}},
		{"completed", "COMPLETED", "final", "", []map[string]any{{"event": "chat.snapshot", "text": "final"}, {"event": "chat.completed"}}},
		{"fallback", "COMPLETED_FALLBACK", "fallback", "", []map[string]any{{"event": "chat.snapshot", "text": "fallback"}, {"event": "chat.completed"}}},
		{"input blocked", "INPUT_BLOCKED", "", "", []map[string]any{{"event": "chat.blocked"}}},
		{"output blocked", "OUTPUT_BLOCKED", "", "", []map[string]any{{"event": "chat.blocked"}}},
		{"cancelled", "CANCELLED", "", "", []map[string]any{{"event": "chat.cancelled"}}},
		{"failed without known cause", "FAILED_FINAL", "", "", []map[string]any{{"event": "chat.failed"}}},
		{"provider disabled", "FAILED_FINAL", "", "PROVIDER_DISABLED", []map[string]any{{"event": "chat.failed", "fault": "model-providers-disabled"}}},
		{"provider timeout", "FAILED_FINAL", "", "TIMEOUT_FIRST_TOKEN", []map[string]any{{"event": "chat.failed", "fault": "external-timed_out"}}},
		{"recovered timeout", "FAILED_FINAL", "", "TIMEOUT", []map[string]any{{"event": "chat.failed", "fault": "external-timed_out"}}},
		{"other known provider failure", "FAILED_FINAL", "", "HTTP_5XX", []map[string]any{{"event": "chat.failed", "fault": "external-failed"}}},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			got := generationSnapshotEvents(postgres.GenerationSnapshot{
				Status: tt.status, AssistantContent: tt.text, FailureCode: tt.failureCode,
			})
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("events = %#v, want %#v", got, tt.want)
			}
		})
	}
}
