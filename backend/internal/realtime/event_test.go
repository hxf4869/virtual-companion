package realtime

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

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

// TestSplitEscapedTextEventCap covers the payloads the terminal snapshot
// replay actually sends: json.Marshal HTML-escapes `<`, `>`, and `&` into
// six-byte sequences, so a logical 16 KiB prefix encodes well past the event
// cap and fit must shrink on the monotonic prefix relation instead of
// re-encoding one byte at a time.
func TestSplitEscapedTextEventCap(t *testing.T) {
	t.Parallel()
	text := strings.Repeat("<a>&", (MaxEventBytes/4)+200)
	parts := splitNamed(companion.EventSnapshot, text)
	if parts[0].Name != companion.EventSnapshot {
		t.Fatalf("first %s", parts[0].Name)
	}
	var joined string
	for _, p := range parts {
		if p.Size() > MaxEventBytes {
			t.Fatalf("event %d bytes", p.Size())
		}
		joined += p.Text
	}
	if joined != text {
		t.Fatalf("round-trip: joined %d want %d", len(joined), len(text))
	}
	if len(parts) < 2 {
		t.Fatalf("escaped text must split, got %d", len(parts))
	}
}

// TestSplitMixedUTF8RoundTrip rebuilds a mixed multi-byte payload exactly.
func TestSplitMixedUTF8RoundTrip(t *testing.T) {
	t.Parallel()
	unit := "你好<世界>&🎉"
	reps := (MaxEventBytes / len(unit)) + 20
	text := strings.Repeat(unit, reps)
	parts := splitNamed(companion.EventDelta, text)
	var joined string
	for _, p := range parts {
		if p.Size() > MaxEventBytes {
			t.Fatalf("event %d bytes", p.Size())
		}
		joined += p.Text
	}
	if joined != text {
		t.Fatalf("round-trip: joined %d want %d", len(joined), len(text))
	}
}

// TestSplitRebuildsThroughJSONDecode guards the wire semantics, not just the
// in-memory ones: an invalid UTF-8 frame Text is silently replaced with
// U+FFFD when json.Marshal encodes the payload, and byte-concatenating Text
// cannot see that corruption. Each frame must stay valid UTF-8, stay within
// the event cap, keep snapshot-first/delta-rest naming, and the JSON-decoded
// texts must rebuild the original text exactly. Covers the emoji payload
// where a prefix cut inside a multi-byte rune corrupted both frames (Root
// direct regression, direct rc1) plus escaped and mixed payloads.
func TestSplitRebuildsThroughJSONDecode(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		text string
	}{
		{"emoji", strings.Repeat("🙂", 5000)},
		{"escaped", strings.Repeat("<a>&", (MaxEventBytes/4)+200)},
		{"mixed", strings.Repeat("<你🙂&", (MaxEventBytes/5)+50)},
		// Single short runes: a prefix cut inside the only rune must not
		// collapse the whole event to an empty snapshot or a silently
		// dropped delta — the normal provider case of emitting one CJK
		// character or emoji at a time (Root direct regression, rc1).
		{"short-cjk", "你"},
		{"short-emoji", "🙂"},
		{"short-latin1", "é"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if d := splitNamed(companion.EventDelta, tc.text); len(d) == 0 {
				t.Fatalf("delta split silently dropped the text")
			}
			parts := splitNamed(companion.EventSnapshot, tc.text)
			if len(parts) == 0 {
				t.Fatalf("payload produced no frames")
			}
			if parts[0].Name != companion.EventSnapshot {
				t.Fatalf("first frame %s", parts[0].Name)
			}
			for i, p := range parts {
				if i > 0 && p.Name != companion.EventDelta {
					t.Fatalf("frame %d name %s", i, p.Name)
				}
				if !utf8.ValidString(p.Text) {
					t.Fatalf("frame %d text is invalid UTF-8", i)
				}
				if p.Size() > MaxEventBytes {
					t.Fatalf("frame %d encoded %d bytes", i, p.Size())
				}
			}
			var joined string
			for _, p := range parts {
				var v struct {
					Event string `json:"event"`
					Text  string `json:"text"`
				}
				if err := json.Unmarshal(p.payload(), &v); err != nil {
					t.Fatalf("frame decode: %v", err)
				}
				joined += v.Text
			}
			if joined != tc.text {
				t.Fatalf("wire rebuild mismatch: %d vs %d bytes", len(joined), len(tc.text))
			}
		})
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
