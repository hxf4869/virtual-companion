package postgres

import "testing"

func TestRecallGateKeepsActualQuestionsAndMixedTurns(t *testing.T) {
	for _, text := range []string{"你好，我上次说喜欢什么茶？", "明天呢？", "几点", "我的猫叫什么", "我为什么难过", "1234", "下周五去哪", "有点累，之前说的休假是什么时候？"} {
		if !shouldRecallMemory(text) {
			t.Errorf("factual query was gated: %q", text)
		}
	}
	for _, text := range []string{"你好！", "在吗", "谢谢呀", "嗯嗯", "我好难过……", "困了", "😭😭", "🥺❤️", "(T_T)", "QAQ"} {
		if shouldRecallMemory(text) {
			t.Errorf("pure reaction recalled: %q", text)
		}
	}
}
