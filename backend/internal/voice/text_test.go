package voice

import "testing"

func TestCleanTextKeepsSpokenWordsOnly(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{`你好～😊（挥手）*抱抱*<sticker tag="开心"/><voice/>`, "你好，"},
		{"## 标题\n- **认真**说[句话](https://example.invalid)", "标题 认真说句话"},
		{"好呀！！！晚安……", "好呀！晚安…"},
		{"😊<voice/>", ""},
		{"这是原文", "这是原文"},
	} {
		if got := CleanText(tc.input); got != tc.want {
			t.Errorf("cleaning mismatch: got %q want %q", got, tc.want)
		}
	}
}
