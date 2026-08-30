package realtime

import (
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

func TestEncodeHasNoSSEID(t *testing.T) {
	t.Parallel()
	ev := newEvent(companion.EventDelta, "你好")
	raw := Encode(ev)
	if hasSSEID(raw) {
		t.Fatalf("sse id present: %q", raw)
	}
	s := string(raw)
	if !strings.HasPrefix(s, "event: chat.delta\n") || !strings.Contains(s, `"text":"你好"`) {
		t.Fatalf("encode %q", s)
	}
}

func TestSnapshotEmptyIncludesText(t *testing.T) {
	t.Parallel()
	raw := string(Encode(newEvent(companion.EventSnapshot, "")))
	if !strings.Contains(raw, `"text":""`) {
		t.Fatalf("empty snapshot must carry text: %s", raw)
	}
}

func TestSplitUTF8EventCap(t *testing.T) {
	t.Parallel()
	text := strings.Repeat("你", (MaxEventBytes/3)+50)
	parts := splitNamed(companion.EventDelta, text)
	if len(parts) < 2 {
		t.Fatalf("expected split, got %d", len(parts))
	}
	var joined string
	for _, p := range parts {
		if p.Size() > MaxEventBytes {
			t.Fatalf("event %d bytes", p.Size())
		}
		if hasSSEID(Encode(p)) {
			t.Fatal("id")
		}
		joined += p.Text
	}
	if joined != text {
		t.Fatal("round-trip")
	}
}

func TestSnapshotThenDeltaSplit(t *testing.T) {
	t.Parallel()
	text := strings.Repeat("a", MaxEventBytes+80)
	parts := snapshotEvents(text)
	if parts[0].Name != companion.EventSnapshot {
		t.Fatalf("first %s", parts[0].Name)
	}
	if len(parts) < 2 || parts[1].Name != companion.EventDelta {
		t.Fatalf("rest %+v", parts)
	}
}

func TestTerminalHasNoBody(t *testing.T) {
	t.Parallel()
	raw := string(Encode(newEvent(companion.EventBlocked, "secret-partial")))
	if strings.Contains(raw, "secret-partial") {
		t.Fatal("terminal leaked text")
	}
	if !newEvent(companion.EventBlocked, "").Terminal() || newEvent(companion.EventDelta, "x").Terminal() {
		t.Fatal("terminal flag")
	}
}
