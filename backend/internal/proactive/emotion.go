package proactive

import (
	"math"
	"strings"
	"time"
)

const (
	baselineFloor = 20
	baselineCeil  = 80
	moodHalf      = 6 * time.Hour
	energyHalf    = 6 * time.Hour
	closeHalf     = 72 * time.Hour
	busyFor       = 7 * 24 * time.Hour
)

// Emotion 是衰减后的瞬时状态。基线只被长期好感缓慢移动。
type Emotion struct {
	Closeness int
	Mood      int
	Energy    int
	Line      string
	At        time.Time

	CloseBase  int
	MoodBase   int
	EnergyBase int
}

func Baseline() Emotion {
	return Emotion{Closeness: 50, Mood: 50, Energy: 50, CloseBase: 50, MoodBase: 50, EnergyBase: 50, Line: EmotionLine(50, 50, 50)}
}

// Decay 只改变返回值，不落库。
func Decay(e Emotion, now time.Time) Emotion {
	if e.At.IsZero() || !now.After(e.At) {
		e.Line = EmotionLine(e.Closeness, e.Mood, e.Energy)
		return e
	}
	e.Mood = approach(e.Mood, e.MoodBase, now.Sub(e.At), moodHalf)
	e.Energy = approach(e.Energy, e.EnergyBase, now.Sub(e.At), energyHalf)
	e.Closeness = approach(e.Closeness, e.CloseBase, now.Sub(e.At), closeHalf)
	e.At = now
	e.Line = EmotionLine(e.Closeness, e.Mood, e.Energy)
	return e
}

func approach(value, base int, elapsed, half time.Duration) int {
	if half <= 0 {
		return base
	}
	keep := math.Pow(0.5, float64(elapsed)/float64(half))
	next := float64(base) + (float64(value)-float64(base))*keep
	return clamp(int(math.Round(next)), 0, 100)
}

// ApplyText 先按 at 衰减，再按本条用户文本加减。同一 sourceRef 不重复加。
func ApplyText(e Emotion, text, sourceRef, seenRef string, at time.Time) (Emotion, bool) {
	if sourceRef != "" && sourceRef == seenRef {
		return Decay(e, at), false
	}
	e = Decay(e, at)
	if e.CloseBase == 0 && e.MoodBase == 0 && e.EnergyBase == 0 {
		e.CloseBase, e.MoodBase, e.EnergyBase = 50, 50, 50
	}
	for _, hit := range moodUp {
		if strings.Contains(text, hit) {
			e.Mood += 12
		}
	}
	for _, hit := range moodDown {
		if strings.Contains(text, hit) {
			e.Mood -= 15
		}
	}
	for _, hit := range energyDown {
		if strings.Contains(text, hit) {
			e.Energy -= 12
		}
	}
	for _, hit := range energyUp {
		if strings.Contains(text, hit) {
			e.Energy += 10
		}
	}
	for _, hit := range closeUp {
		if strings.Contains(text, hit) {
			e.Closeness += 8
			e.CloseBase = clamp(e.CloseBase+1, baselineFloor, baselineCeil)
		}
	}
	for _, hit := range closeDown {
		if strings.Contains(text, hit) {
			e.Closeness -= 10
			e.CloseBase = clamp(e.CloseBase-1, baselineFloor, baselineCeil)
		}
	}
	e.Mood = clamp(e.Mood, 0, 100)
	e.Energy = clamp(e.Energy, 0, 100)
	e.Closeness = clamp(e.Closeness, 0, 100)
	e.At = at
	e.Line = EmotionLine(e.Closeness, e.Mood, e.Energy)
	return e, true
}

func EmotionLine(closeness, mood, energy int) string {
	switch {
	case mood >= 70 && energy >= 60:
		return "这会儿心情不错，也有精神"
	case mood <= 35:
		return "这会儿情绪有点低"
	case energy <= 35:
		return "这会儿有点没精神"
	case closeness >= 70:
		return "这会儿挺想靠近对方"
	default:
		return "这会儿状态平稳"
	}
}

// BusyUntil 命中忙碌关键词时返回消息时间加 7 天；否则零值，表示应清除忙碌。
func BusyUntil(text string, at time.Time) time.Time {
	if !mentionsBusy(text) {
		return time.Time{}
	}
	return at.Add(busyFor)
}

func mentionsBusy(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return false
	}
	if strings.Contains(text, "在开会") || strings.Contains(text, "开会") || strings.Contains(text, "打游戏") || strings.Contains(text, "玩游戏") {
		return true
	}
	cleaned := strings.NewReplacer("帮忙", "", "不忙", "", "忙完", "").Replace(text)
	return strings.Contains(cleaned, "忙")
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

var (
	moodUp     = []string{"开心", "高兴", "哈哈", "好耶", "升职", "太好了", "喜欢"}
	moodDown   = []string{"难过", "伤心", "崩溃", "低落", "难受", "想哭", "烦死", "好烦", "心烦", "烦恼", "emo"}
	energyDown = []string{"好困", "困死", "困了", "好累", "累死", "疲惫", "没精神"}
	energyUp   = []string{"睡醒", "有精神", "兴奋"}
	closeUp    = []string{"想你", "抱抱", "爱你", "喜欢你"}
	closeDown  = []string{"别烦我", "不想理你", "讨厌你", "滚"}
)
