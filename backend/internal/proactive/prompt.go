package proactive

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

func judgmentPrompt(w World, found []Trigger) string {
	var b strings.Builder
	b.WriteString("你是")
	b.WriteString(nameOr(w.CharName))
	b.WriteString("。现在是")
	b.WriteString(partOfDay(w.Now, w.loc()))
	b.WriteString("，你们上次聊天是")
	b.WriteString(sinceLast(w))
	b.WriteString("之前，最后几句是：\n")
	b.WriteString(blank(w.RecentTurns, ""))
	b.WriteString("\n可能的由头：\n")
	for _, item := range found {
		b.WriteString(fill(item.Line, w))
		b.WriteString("\n")
	}
	b.WriteString("今天你的状态：")
	b.WriteString(w.Mood.Vibe)
	b.WriteString("。对方已经连续 ")
	b.WriteString(strconv.Itoa(w.Unanswered))
	b.WriteString(" 次没回你的主动消息。\n")
	b.WriteString(JudgmentInstruction)
	if strings.TrimSpace(w.Topic) != "" {
		b.WriteString(topicData(w.Topic))
	}
	return strings.TrimRight(b.String(), "\n")
}

func pregenPrompt(w World, item Trigger) string {
	var b strings.Builder
	b.WriteString("你是")
	b.WriteString(nameOr(w.CharName))
	b.WriteString("，现在是")
	b.WriteString(partOfDay(w.Now, w.loc()))
	b.WriteString("，你们")
	b.WriteString(sinceLast(w))
	b.WriteString("没聊了。你想主动给")
	b.WriteString(nameOr(w.UserName))
	b.WriteString("发条消息，由头是：")
	b.WriteString(fill(item.Line, w))
	b.WriteString("。\n")
	b.WriteString(PregenInstruction)
	if item.Kind == KindContinue {
		b.WriteString(topicData(w.Topic))
	}
	b.WriteString("\n最近你主动发过的话（不要重复意思或句式）：\n")
	b.WriteString(blank(w.RecentProactive, ""))
	if w.Unanswered == 1 {
		b.WriteString("\n")
		b.WriteString(UnansweredOnce)
	}
	return b.String()
}

func topicData(topic string) string {
	data, _ := json.Marshal(struct {
		Text string `json:"text"`
	}{topic})
	return "\n" + TopicDataInstruction + "\n<vc-open-topic>\n" + string(data) + "\n</vc-open-topic>\n"
}

func fill(line string, w World) string {
	return strings.NewReplacer(
		"{{user}}", nameOr(w.UserName),
		"{{char}}", nameOr(w.CharName),
		"{{topic}}", strings.TrimSpace(w.Topic),
		"{{shareSeed}}", ShareSeed,
	).Replace(line)
}

func nameOr(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "你"
	}
	return value
}

func blank(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func partOfDay(now time.Time, loc *time.Location) string {
	hour := now.In(loc).Hour()
	switch {
	case hour < 5:
		return "凌晨"
	case hour < 11:
		return "早上"
	case hour < 13:
		return "中午"
	case hour < 18:
		return "下午"
	default:
		return "晚上"
	}
}

func sinceLast(w World) string {
	anchor := w.LastUserAt
	if w.LastProactiveAt.After(anchor) {
		anchor = w.LastProactiveAt
	}
	if anchor.IsZero() {
		return "很久"
	}
	d := w.Now.Sub(anchor)
	if d < time.Hour {
		return "不到一个小时"
	}
	if d < 24*time.Hour {
		hours := int(d / time.Hour)
		if d%time.Hour > 0 {
			return zhCount(hours) + "个多小时"
		}
		return zhCount(hours) + "个小时"
	}
	days := int(d / (24 * time.Hour))
	if days < 1 {
		days = 1
	}
	return zhCount(days) + "天"
}

func zhCount(n int) string {
	words := []string{"零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"}
	if n >= 0 && n < len(words) {
		return words[n]
	}
	return strconv.Itoa(n)
}
