package jobs

import "testing"

func TestQuestionsAndSpeculationCannotBecomeConfirmedMemory(t *testing.T) {
	cases := []struct{ source, payload string }{
		{"我喜欢喝茶吗？", `[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"我喜欢喝茶"}]`},
		{"我可能喜欢喝茶", `[{"summary":"用户可能喜欢喝茶","category":"PREFERENCE","evidence":"我可能喜欢喝茶"}]`},
	}
	for _, c := range cases {
		items, valid := parseExtractOutput(c.payload, 3, c.source)
		if valid && len(items) > 0 {
			t.Errorf("non-factual source accepted: %q -> %q", c.source, items[0].Summary)
		}
	}
}

func TestExplicitStatementAfterQuestionStillExtracts(t *testing.T) {
	items, valid := parseExtractOutput(`[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"我喜欢喝茶"}]`, 3, "你喜欢什么？我喜欢喝茶。")
	if !valid || len(items) != 1 {
		t.Fatalf("explicit source rejected: %v %v", items, valid)
	}
}
