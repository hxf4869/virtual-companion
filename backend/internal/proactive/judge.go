package proactive

import (
	"encoding/json"
	"strings"
)

// Decision 是判断模型允许的一行结果。
type Decision struct {
	Kind   string `json:"kind"`
	Timing string `json:"timing"`
}

var kinds = map[string]bool{KindSilent: true, KindCheckIn: true, KindContinue: true, KindShare: true, KindCare: true}
var timings = map[string]bool{
	"in_minutes": true, "in_half_hour": true, "in_hours": true,
	"later_today": true, "next_morning": true, "next_noon": true, "next_evening": true,
}

// ParseJudgment 只接受一行 JSON。多余文字、未知 kind 或未知 timing 都算失败。
func ParseJudgment(raw string) (Decision, bool) {
	line := strings.TrimSpace(raw)
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		if strings.TrimSpace(line[i:]) != "" {
			return Decision{}, false
		}
		line = strings.TrimSpace(line[:i])
	}
	var got Decision
	if err := json.Unmarshal([]byte(line), &got); err != nil {
		return Decision{}, false
	}
	if !kinds[got.Kind] || !timings[got.Timing] {
		return Decision{}, false
	}
	return got, true
}
