package proactive

import (
	"hash/fnv"
	"strconv"
	"time"
)

const (
	MoodWant  = "WANT_TO_CHAT"
	MoodChill = "JUST_CHILL"
	MoodLeave = "LEAVE_ME"
)

// Mood 是某一本地日的今日心情。Redrawn 表示当天已经用过一次降低权重的重抽。
type Mood struct {
	Tier    string
	Vibe    string
	Line    string
	Redrawn bool
	Date    string
}

// EnsureMood 按关系与本地日期确定性落档。已有当天记录直接返回；
// 当天 18:00 之后、档位是 LEAVE_ME、双方都还没开口且尚未重抽时，用 75/20/5 重抽一次。
func EnsureMood(relationshipID int64, now time.Time, loc *time.Location, stored *Mood, spokeToday bool) Mood {
	if loc == nil {
		loc = shanghai
	}
	local := now.In(loc)
	date := local.Format("2006-01-02")
	if stored != nil && stored.Date == date && stored.Tier != "" {
		if !stored.Redrawn && stored.Tier == MoodLeave && !spokeToday && local.Hour() >= 18 {
			next := rollMood(relationshipID, date+"#redraw", []int{75, 20, 5})
			next.Date = date
			next.Redrawn = true
			return next
		}
		return *stored
	}
	rolled := rollMood(relationshipID, date, []int{70, 20, 10})
	rolled.Date = date
	return rolled
}

func rollMood(relationshipID int64, salt string, weights []int) Mood {
	h := fnv.New64a()
	_, _ = h.Write([]byte(strconv.FormatInt(relationshipID, 10) + "|" + salt))
	sum := weights[0] + weights[1] + weights[2]
	pick := int(h.Sum64() % uint64(sum))
	tier := MoodLeave
	switch {
	case pick < weights[0]:
		tier = MoodWant
	case pick < weights[0]+weights[1]:
		tier = MoodChill
	}
	pairs := moodCatalog[tier]
	pair := pairs[int((h.Sum64()>>8)%uint64(len(pairs)))]
	return Mood{Tier: tier, Vibe: pair.Vibe, Line: pair.Line}
}

func intervalMultiplier(tier string) float64 {
	switch tier {
	case MoodWant:
		return 1
	case MoodLeave:
		return 2
	default:
		return 1.5
	}
}
