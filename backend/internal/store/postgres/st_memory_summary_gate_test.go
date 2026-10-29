package postgres

import (
	"encoding/json"
	"testing"
)

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

func TestSceneGateUsesRerankIDs(t *testing.T) {
	scenes := []profileScene{
		{Summary: "周日阅读留在场景里", RecordIDs: []string{"a"}},
		{Summary: "周日阅读不该进入注入", RecordIDs: []string{"a"}},
	}
	chosen := chooseProfileScenes("今天是周日阅读计划", scenes, []string{"a"}, nil, []string{"scene-0"}, false, true)
	if len(chosen) != 1 || chosen[0].Summary != "周日阅读留在场景里" {
		t.Fatalf("rerank gate %+v", chosen)
	}
	lexical := chooseProfileScenes("今天是周日阅读计划", scenes, []string{"a"}, nil, nil, false, false)
	if len(lexical) != 2 {
		t.Fatalf("lexical gate %+v", lexical)
	}
	dated := chooseProfileScenes("今天是周日阅读计划", scenes, []string{"a"}, nil, []string{"scene-0"}, true, true)
	if len(dated) != 0 {
		t.Fatalf("other-day scene leaked %+v", dated)
	}
}

func TestDecodeEngineSearchKeepsRerankDecision(t *testing.T) {
	raw := json.RawMessage(`{"hits":[{"record_id":"a"}],"gated":["persona"],"stats":{"rerankDecision":"timeout","rerankCandidates":4,"rerankKept":0,"rerankOnly":1,"rerankFallback":1,"rerankGateFallback":1,"summaryGateAllow":2}}`)
	hits, gated, known, observed := decodeEngineSearch(raw)
	if !known || len(hits) != 1 || hits[0].RecordID != "a" || len(gated) != 1 || gated[0] != "persona" {
		t.Fatalf("hits=%+v gated=%v known=%v", hits, gated, known)
	}
	if observed.RerankDecision != "timeout" || observed.RerankCandidates != 4 || observed.RerankKept != 0 || observed.RerankOnly != 1 || observed.RerankFallback != 1 || observed.RerankGateFallback != 1 || observed.SummaryAllow != 2 {
		t.Fatalf("observe %+v", observed)
	}
}
