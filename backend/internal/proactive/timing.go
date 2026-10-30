package proactive

import (
	"time"
)

var shanghai = mustZone()

// Zone 把策略时区解析成地点。空名或无法识别时用 Asia/Shanghai。
func Zone(name string) *time.Location {
	if name != "" {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	return shanghai
}

func mustZone() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("Asia/Shanghai", 8*3600)
	}
	return loc
}

// Slot 在代码里把 timing 换成发送时刻，并避开安静时段。rand(n) 返回 [0,n)。
func Slot(now time.Time, loc *time.Location, timing string, rand func(int) int, quietStart, quietEnd string) time.Time {
	if loc == nil {
		loc = shanghai
	}
	if rand == nil {
		rand = func(int) int { return 0 }
	}
	local := now.In(loc)
	var at time.Time
	switch timing {
	case "in_minutes":
		at = local.Add(time.Duration(1+rand(10)) * time.Minute)
	case "in_half_hour":
		at = local.Add(time.Duration(10+rand(31)) * time.Minute)
	case "in_hours":
		at = local.Add(time.Duration(60+rand(121)) * time.Minute)
	case "later_today":
		at = laterToday(local, rand)
	case "next_morning":
		at = nextWindow(local, 8, 0, 10, 0, rand)
	case "next_noon":
		at = nextWindow(local, 11, 30, 13, 30, rand)
	case "next_evening":
		at = nextWindow(local, 18, 0, 21, 0, rand)
	default:
		at = local.Add(time.Minute)
	}
	return avoidQuiet(at, loc, quietStart, quietEnd, rand)
}

func laterToday(local time.Time, rand func(int) int) time.Time {
	start := local.Add(2 * time.Hour)
	end := time.Date(local.Year(), local.Month(), local.Day(), 21, 0, 0, 0, local.Location())
	if !start.Before(end) {
		return nextWindow(local, 18, 0, 21, 0, rand)
	}
	span := int(end.Sub(start) / time.Minute)
	if span < 1 {
		span = 1
	}
	return start.Add(time.Duration(rand(span)) * time.Minute)
}

func nextWindow(local time.Time, sh, sm, eh, em int, rand func(int) int) time.Time {
	start := time.Date(local.Year(), local.Month(), local.Day(), sh, sm, 0, 0, local.Location())
	end := time.Date(local.Year(), local.Month(), local.Day(), eh, em, 0, 0, local.Location())
	if !local.Before(start) {
		start = start.Add(24 * time.Hour)
		end = end.Add(24 * time.Hour)
	}
	span := int(end.Sub(start) / time.Minute)
	if span < 1 {
		span = 1
	}
	return start.Add(time.Duration(rand(span)) * time.Minute)
}

func avoidQuiet(at time.Time, loc *time.Location, start, end string, rand func(int) int) time.Time {
	if !inQuiet(at, loc, start, end) {
		return at
	}
	eh, em, ok := clock(end)
	if !ok {
		return at
	}
	local := at.In(loc)
	resume := time.Date(local.Year(), local.Month(), local.Day(), eh, em, 0, 0, loc)
	if !resume.After(local) {
		resume = resume.Add(24 * time.Hour)
	}
	return resume.Add(time.Duration(5+rand(36)) * time.Minute)
}

func clock(value string) (int, int, bool) {
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return 0, 0, false
	}
	return parsed.Hour(), parsed.Minute(), true
}
