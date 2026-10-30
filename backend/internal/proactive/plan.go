package proactive

import (
	"strings"
	"time"
)

// Plan 是纯函数给出的下一步。Prompt 非空时调用方按 Temperature 请求模型。
type Plan struct {
	Outcome     string
	Reason      string
	Prompt      string
	Temperature float64
	Trigger     Trigger
	SendAt      time.Time
	ArmedAt     time.Time
}

const (
	OutcomeGated  = "GATED"
	OutcomeSilent = "SILENT"
	OutcomeJudge  = "JUDGE"
	OutcomePregen = "PREGEN"
	OutcomeReady  = "READY"

	JudgmentTemperature = 0.2
	lateAfter           = 2 * time.Hour
)

// Judge 在硬门卫通过且有候选时返回判断提示。
func Judge(w World) Plan {
	if reason := Block(w); reason != "" {
		return Plan{Outcome: OutcomeGated, Reason: reason}
	}
	found := candidates(w)
	if len(found) == 0 {
		return Plan{Outcome: OutcomeGated, Reason: ReasonNoCandidate}
	}
	return Plan{Outcome: OutcomeJudge, Prompt: judgmentPrompt(w, found), Temperature: JudgmentTemperature}
}

// AfterJudgment 解析一行 JSON。失败、沉默或 kind 没有候选都按沉默，不设冷却。
func AfterJudgment(w World, raw string) Plan {
	found := candidates(w)
	decision, ok := ParseJudgment(raw)
	if !ok {
		return Plan{Outcome: OutcomeSilent, Reason: ReasonParse}
	}
	if decision.Kind == KindSilent {
		return Plan{Outcome: OutcomeSilent, Reason: ReasonSilent}
	}
	pool := make([]Trigger, 0, len(found))
	for _, item := range found {
		if item.Kind == decision.Kind {
			pool = append(pool, item)
		}
	}
	if len(pool) == 0 {
		return Plan{Outcome: OutcomeSilent, Reason: ReasonSilent}
	}
	chosen := pool[pickWeighted(pool, w.rand)]
	sendAt := Slot(w.Now, w.loc(), decision.Timing, w.rand, w.Policy.QuietStart, w.Policy.QuietEnd)
	return Plan{
		Outcome: OutcomePregen, Trigger: chosen, SendAt: sendAt, ArmedAt: w.LastUserAt,
		Prompt: pregenPrompt(w, chosen), Temperature: 0,
	}
}

func candidates(w World) []Trigger {
	out := make([]Trigger, 0, 7)
	for _, item := range catalog() {
		if allowsMode(item, w.Policy.Mode) && eligible(w, item) {
			out = append(out, item)
		}
	}
	return out
}

func eligible(w World, item Trigger) bool {
	if cooling(w, "trigger:"+item.Key) || cooling(w, "cluster:"+item.Cluster) {
		return false
	}
	switch item.Key {
	case "follow_up_due":
		return w.DueFollowUp
	case "good_morning":
		return hourBetween(w, 8, 11) && socialGap(w, item)
	case "good_night":
		return hourBetween(w, 21, 23) && socialGap(w, item)
	case "cold_hello":
		return socialGap(w, item)
	case "continue_topic":
		return strings.TrimSpace(w.Topic) != "" && socialGap(w, item)
	case "share_day":
		return socialGap(w, item)
	case "care":
		decayed := Decay(w.Emotion, w.Now)
		quietUser := w.LastUserAt.IsZero() || w.Now.Sub(w.LastUserAt) >= 30*time.Minute
		return decayed.Mood < 40 && quietUser && socialGap(w, item)
	default:
		return false
	}
}

func socialGap(w World, item Trigger) bool {
	if item.Reminder {
		return true
	}
	if w.Mood.Tier == MoodLeave {
		return false
	}
	if w.LastUserAt.IsZero() && w.LastProactiveAt.IsZero() {
		return false
	}
	anchor := w.LastUserAt
	if w.LastProactiveAt.After(anchor) {
		anchor = w.LastProactiveAt
	}
	minutes := w.Policy.CheckInAfterMinutes
	if minutes <= 0 {
		minutes = 720
	}
	need := time.Duration(float64(time.Duration(minutes)*time.Minute) * intervalMultiplier(w.Mood.Tier))
	return !anchor.IsZero() && w.Now.Sub(anchor) >= need
}

func cooling(w World, key string) bool {
	until, ok := w.Cooldown[key]
	return ok && w.Now.Before(until)
}

func hourBetween(w World, from, to int) bool {
	hour := w.Now.In(w.loc()).Hour()
	return hour >= from && hour < to
}

func pickWeighted(pool []Trigger, rand func(int) int) int {
	total := 0
	for _, item := range pool {
		total += item.Weight
	}
	if total <= 0 {
		return 0
	}
	cursor := rand(total)
	for i, item := range pool {
		cursor -= item.Weight
		if cursor < 0 {
			return i
		}
	}
	return len(pool) - 1
}

// Delivery 判断一条 READY 在 now 是否可以进 inbox。
func Delivery(now, planned, lastUser, armed time.Time, reminder bool) (bool, string) {
	if planned.IsZero() {
		return false, ReasonWait
	}
	if now.After(planned.Add(lateAfter)) {
		return false, ReasonExpired
	}
	if !reminder && !armed.IsZero() && lastUser.After(armed) {
		return false, ReasonCancelled
	}
	if now.Before(planned) {
		return false, ReasonWait
	}
	return true, ""
}

func inQuiet(now time.Time, loc *time.Location, start, end string) bool {
	if start == "" || end == "" || start == end {
		return false
	}
	sh, sm, ok := clock(start)
	if !ok {
		return false
	}
	eh, em, ok := clock(end)
	if !ok {
		return false
	}
	local := now.In(loc)
	cur := local.Hour()*60 + local.Minute()
	a := sh*60 + sm
	b := eh*60 + em
	if a < b {
		return cur >= a && cur < b
	}
	return cur >= a || cur < b
}
