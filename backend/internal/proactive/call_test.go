package proactive

import (
	"strings"
	"testing"
	"time"
)

func TestCallNeedsVoiceTopicAndCloseFriend(t *testing.T) {
	now := time.Date(2026, 11, 2, 14, 0, 0, 0, shanghai)
	w := closeWorld(now)
	decision := `{"kind":"call","timing":"in_minutes"}`
	if got := AfterJudgment(w, decision); got.Outcome != OutcomeSilent {
		t.Fatal("call without voice/topic", got.Outcome)
	}
	w.CallAvailable = true
	w.Topic = "上次聊到的书"
	w.TopicRef = "stmsg:topic"
	got := AfterJudgment(w, decision)
	if got.Outcome != OutcomePregen || got.Trigger.Kind != KindCall || got.TopicRef != w.TopicRef || !strings.Contains(got.Prompt, "<vc-open-topic>") {
		t.Fatalf("call plan: %+v", got)
	}
	w.Policy.Mode = ModeDaily
	if got := AfterJudgment(w, decision); got.Outcome != OutcomeSilent {
		t.Fatal("daily mode rang")
	}
	w.Policy.Mode = ModeCloseFriend
	w.Cooldown = map[string]time.Time{"trigger:call": now.Add(time.Hour)}
	if got := AfterJudgment(w, decision); got.Outcome != OutcomeSilent {
		t.Fatal("call cooldown ignored")
	}
	w.Cooldown = nil
	w.Policy.QuietStart = "13:00"
	w.Policy.QuietEnd = "16:00"
	if got := Judge(w); got.Outcome != OutcomeGated {
		t.Fatal("quiet hours ignored")
	}
}
