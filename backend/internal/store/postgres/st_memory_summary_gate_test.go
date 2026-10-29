package postgres

import "testing"

func TestDatedSummaryKeepsUndatedTopicFromUndatedSources(t *testing.T) {
	if queryHasUndatedTopic("我下周五有什么安排？") {
		t.Fatal("a single schedule question is not an undated topic")
	}
	mixed := "我在2026年10月30日准备去哪里，为什么？我们上次读书计划谈到哪一步了？（关闭记忆合成验证）"
	if !queryHasUndatedTopic(mixed) {
		t.Fatal("the reading question is an undated topic")
	}
	if !genericScheduleQuestion("10月30日我要去哪里？") || genericScheduleQuestion("十一月六日我在哪里举行婚礼？") {
		t.Fatal("schedule residual drifted from the engine gate")
	}
	reading := "我们决定暂停读书计划，等下次再选书。"
	if personaAllowed(reading, "我下周五有什么安排？", true, []string{"reading"}, nil, []string{"reading"}, nil, []string{"persona"}, true) {
		t.Fatal("pure dated question kept a summary whose sources missed that day")
	}
	if !personaAllowed(reading, mixed, true, []string{"reading"}, nil, []string{"reading"}, nil, []string{"persona"}, true) {
		t.Fatal("undated reading summary was dropped from a mixed question")
	}
	if personaAllowed(reading, mixed, true, []string{"reading"}, nil, []string{"reading"}, nil, nil, true) {
		t.Fatal("relevance rejection was ignored")
	}
	if personaAllowed("用户将去厦门参加朋友婚礼。", mixed, true, []string{"wedding"}, nil, nil, []string{"wedding"}, []string{"persona"}, true) {
		t.Fatal("a summary sourced on another day leaked through the undated topic")
	}
	if !personaAllowed(reading, mixed, true, []string{"reading"}, []string{"reading"}, []string{"reading"}, nil, []string{"persona"}, true) {
		t.Fatal("same-day source was dropped")
	}
}
