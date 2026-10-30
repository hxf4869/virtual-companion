package proactive

import "time"

const (
	KindSilent   = "stay_silent"
	KindCheckIn  = "check_in"
	KindContinue = "continue_topic"
	KindShare    = "share"
	KindCare     = "care"

	ModeOff         = "OFF"
	ModeFollowUp    = "FOLLOW_UP"
	ModeDaily       = "DAILY"
	ModeCloseFriend = "CLOSE_FRIEND"

	ClusterReminder = "reminder"
	ClusterGreeting = "greeting"
	ClusterTopic    = "topic"
	ClusterShare    = "share"
	ClusterCare     = "care"
)

// Trigger 是一条可被选中的由头。Reminder 不受心情与最小间隔限制，用户插话也不取消。
type Trigger struct {
	Key       string
	Kind      string
	Cluster   string
	Weight    int
	Cooldown  time.Duration
	ClusterCD time.Duration
	Modes     []string
	Reminder  bool
	Line      string
}

func catalog() []Trigger {
	return []Trigger{
		{Key: "follow_up_due", Kind: KindCheckIn, Cluster: ClusterReminder, Weight: 5, Cooldown: 24 * time.Hour, Modes: []string{ModeFollowUp, ModeDaily, ModeCloseFriend}, Reminder: true, Line: TriggerFollowUpDue},
		{Key: "cold_hello", Kind: KindCheckIn, Cluster: ClusterGreeting, Weight: 3, Cooldown: 20 * time.Hour, ClusterCD: 6 * time.Hour, Modes: []string{ModeDaily, ModeCloseFriend}, Line: TriggerColdHello},
		{Key: "good_morning", Kind: KindCheckIn, Cluster: ClusterGreeting, Weight: 3, Cooldown: 20 * time.Hour, ClusterCD: 6 * time.Hour, Modes: []string{ModeDaily, ModeCloseFriend}, Line: TriggerGoodMorning},
		{Key: "good_night", Kind: KindCheckIn, Cluster: ClusterGreeting, Weight: 3, Cooldown: 20 * time.Hour, ClusterCD: 6 * time.Hour, Modes: []string{ModeDaily, ModeCloseFriend}, Line: TriggerGoodNight},
		{Key: "continue_topic", Kind: KindContinue, Cluster: ClusterTopic, Weight: 3, Cooldown: 12 * time.Hour, Modes: []string{ModeCloseFriend}, Line: TriggerContinueTopic},
		{Key: "share_day", Kind: KindShare, Cluster: ClusterShare, Weight: 2, Cooldown: 18 * time.Hour, Modes: []string{ModeCloseFriend}, Line: TriggerShareDay},
		{Key: "care", Kind: KindCare, Cluster: ClusterCare, Weight: 4, Cooldown: 8 * time.Hour, Modes: []string{ModeCloseFriend}, Line: TriggerCare},
	}
}

func allowsMode(t Trigger, mode string) bool {
	for _, item := range t.Modes {
		if item == mode {
			return true
		}
	}
	return false
}
