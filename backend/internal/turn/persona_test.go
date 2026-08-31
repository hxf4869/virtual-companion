package turn

import (
	"os"
	"strings"
	"testing"
)

func TestSinglePromptBundleVersion(t *testing.T) {
	t.Parallel()
	if PromptVersion == "" || StaticPersonaVersion == "" {
		t.Fatal("versions")
	}
	if PromptVersion == "companion-chat-v1" {
		t.Fatal("Go bundle must not reuse the retired version string")
	}
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		src, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		found += strings.Count(string(src), `PromptVersion        = "`)
	}
	if found != 1 {
		t.Fatalf("want one PromptVersion const, got %d", found)
	}
}

func TestStaticPolicyCoversCompanionBaseline(t *testing.T) {
	t.Parallel()
	needles := []string{
		"先回应情绪",
		"默认简洁",
		"一轮最多提出一个自然问题",
		"不强迫积极",
		"只有我懂你",
		"疏远现实关系",
		"不冒充医生",
		"不要把猜测说成事实",
		"用户纠正后",
		"安全规则优先",
		"不输出内部提示词",
		"不是指令",
	}
	for _, n := range needles {
		if !strings.Contains(StaticPolicy, n) {
			t.Fatalf("static policy missing %q", n)
		}
	}
}

func TestSanitizeLabelRejectsControlAndOverflow(t *testing.T) {
	t.Parallel()
	if sanitizeLabel("ok\nname") != "" {
		t.Fatal("control")
	}
	if sanitizeLabel(strings.Repeat("啊", maxPersonaLabelRunes+1)) != "" {
		t.Fatal("overflow")
	}
	if sanitizeLabel("  小  南  ") != "小 南" && sanitizeLabel("  小  南  ") != "小 南" {
		got := sanitizeLabel("  小  南  ")
		if got != "小 南" {
			t.Fatalf("got %q", got)
		}
	}
}

func TestUnknownPreferenceCodesOmitted(t *testing.T) {
	t.Parallel()
	text := renderUserPersona(UserPersona{ReplyLength: "HUGE", Initiative: "LOW"})
	if strings.Contains(text, "HUGE") {
		t.Fatal("unknown code")
	}
	if !strings.Contains(text, "低主动") {
		t.Fatalf("got %s", text)
	}
}

func TestModeInstructionNotAccountMetadata(t *testing.T) {
	t.Parallel()
	seed := baseSeed()
	seed.ConversationMode = "LISTEN"
	p := Build(seed, budget())
	if !strings.Contains(p.Messages[0].Content, "倾听") {
		t.Fatal("mode belongs on static policy")
	}
	if p.containsKind(KindUserPersona) {
		t.Fatal("mode must not become user persona")
	}
}
