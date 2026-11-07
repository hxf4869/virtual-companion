package postgres

import (
	"strings"
	"testing"
)

func TestSTQueryNeedsRecentTopic(t *testing.T) {
	for _, question := range []string{
		"我们上次谈到哪一步了？",
		"那个项目后来怎么样？",
		"昨天那件事有结果吗？",
		"下一步是什么？",
		"上次聊了什么？",
	} {
		if !stQueryNeedsRecentTopic(question) {
			t.Errorf("missed underspecified question %q", question)
		}
	}
	for _, question := range []string{
		"蓝窗书店的阅读计划上次走到哪一步了？",
		"那个装订计划后来怎么样？",
		"我们上次谈到哪一步了？还记得东门钥匙放在哪里吗？",
		"明天有什么安排？",
		"你记得我喜欢什么茶吗？",
		"嗯，好吧",
	} {
		if stQueryNeedsRecentTopic(question) {
			t.Errorf("would replace original question %q", question)
		}
	}
}

func TestSTRecentUserTopic(t *testing.T) {
	const topic = "蓝窗书店阅读计划"
	cases := []struct {
		name  string
		turns []string
		want  string
	}{
		{"topic then continuation", []string{"今天想继续" + topic + "。", "先回顾一下吧。"}, topic},
		{"repeated topic", []string{"我想聊聊" + topic, "关于" + topic + "：接着聊吧"}, topic},
		{"topic first", []string{topic + "也搁了很久。"}, topic},
		{"two turns name different topics", []string{"我想继续" + topic, "玻璃温室翻新项目也搁了很久。"}, ""},
		{"one turn names alternatives", []string{"想继续" + topic + "还是玻璃温室翻新项目。"}, ""},
		{"same turn switches topic", []string{"今天想继续" + topic + "。我们先说玻璃温室吧。"}, ""},
		{"topic and unrelated unparsed turn", []string{"今天想继续" + topic, "屋顶漏水了。"}, ""},
		{"deictic antecedent", []string{"我想继续那个计划。"}, ""},
		{"only continuation", []string{"先回顾一下吧", "嗯。"}, ""},
		{"hidden turn blocks older hint", []string{"我想继续" + topic, ""}, ""},
		{"oversize turn blocks older hint", []string{"我想继续" + topic, strings.Repeat("语", stRecentTopicRunes+1)}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := stRecentUserTopic(tc.turns); got != tc.want {
				t.Fatalf("topic = %q, want %q", got, tc.want)
			}
		})
	}
}
