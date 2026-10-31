package proactive

import "time"

const (
	ReasonOff         = "OFF"
	ReasonQuiet       = "QUIET"
	ReasonDailyLimit  = "DAILY_LIMIT"
	ReasonInterval    = "INTERVAL"
	ReasonUnanswered  = "UNANSWERED"
	ReasonBusy        = "BUSY"
	ReasonDeletion    = "DELETION"
	ReasonOffline     = "OFFLINE"
	ReasonNoCandidate = "NO_CANDIDATE"
	ReasonInFlight    = "IN_FLIGHT"
	ReasonLegacy      = "FOLLOW_UP_LEGACY"
	ReasonSilent      = "SILENT"
	ReasonParse       = "PARSE"
	ReasonExpired     = "EXPIRED"
	ReasonCancelled   = "CANCELLED"
	ReasonWait        = "WAIT"
)

// PolicyView 是门卫需要的策略切片。
type PolicyView struct {
	Mode                string
	CheckInAfterMinutes int
	DailyLimit          int
	QuietStart          string
	QuietEnd            string
	Timezone            string
	OfflineCapable      bool
	DeletionIntent      bool
}

// World 是一次判断时点的只读快照。
type World struct {
	Now             time.Time
	Location        *time.Location
	Policy          PolicyView
	Mood            Mood
	Emotion         Emotion
	LastUserAt      time.Time
	LastProactiveAt time.Time
	SentToday       int
	Unanswered      int
	BusyUntil       time.Time
	HasReady        bool
	DueFollowUp     bool
	Topic           string
	TopicRef        string
	RecentTurns     string
	RecentProactive string
	CharName        string
	UserName        string
	Cooldown        map[string]time.Time
	Rand            func(n int) int
}

func (w World) loc() *time.Location {
	if w.Location != nil {
		return w.Location
	}
	return shanghai
}

func (w World) rand(n int) int {
	if n <= 1 {
		return 0
	}
	if w.Rand != nil {
		return w.Rand(n)
	}
	return int(w.Now.UnixNano() % int64(n))
}

// Block 返回硬门卫原因。空字符串表示可以继续看由头。
func Block(w World) string {
	p := w.Policy
	switch {
	case p.DeletionIntent:
		return ReasonDeletion
	case p.Mode == "" || p.Mode == ModeOff:
		return ReasonOff
	case p.Mode == ModeFollowUp:
		return ReasonLegacy
	case !w.BusyUntil.IsZero() && w.Now.Before(w.BusyUntil):
		return ReasonBusy
	case w.Unanswered >= 2:
		return ReasonUnanswered
	case inQuiet(w.Now, w.loc(), p.QuietStart, p.QuietEnd):
		return ReasonQuiet
	case p.DailyLimit >= 0 && w.SentToday >= p.DailyLimit:
		return ReasonDailyLimit
	case !p.OfflineCapable:
		return ReasonOffline
	case w.HasReady:
		return ReasonInFlight
	default:
		return ""
	}
}
