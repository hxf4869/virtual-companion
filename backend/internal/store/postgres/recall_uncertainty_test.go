package postgres

import "testing"

func TestRecallUncertaintyIsOnlyAnInjectionMark(t *testing.T) {
	text := "用户住在上海。"
	if got := uncertainMemoryText(text, []string{"old"}, map[string]bool{"old": true}); got != "记不太清——"+text {
		t.Fatal("old source missing mark")
	}
	if got := uncertainMemoryText(text, []string{"new"}, map[string]bool{"old": true}); got != text {
		t.Fatal("fresh source became uncertain")
	}
	for _, word := range []string{"用户好像住在上海。", "用户也许喜欢花茶。"} {
		if uncertainMemoryText(word, nil, nil) != "记不太清——"+word {
			t.Fatal("explicit uncertainty lost")
		}
	}
	if got := uncertainMemoryText("用户不可能吃花生。", nil, nil); got != "用户不可能吃花生。" {
		t.Fatal("negation became confidence")
	}
}
