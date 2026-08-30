package realtime

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

const (
	// MaxEventBytes is the encoded public SSE event cap (UTF-8 split).
	MaxEventBytes = 16 << 10
	// MaxQueueEvents is the per-subscriber live queue event cap.
	MaxQueueEvents = 128
	// MaxQueueBytes is the per-subscriber live queue byte cap.
	MaxQueueBytes = 128 << 10
	// MaxSubscribers is the per-generation live subscriber cap.
	MaxSubscribers = 8
	// MaxAccumulatorBytes bounds the single in-memory final accumulator.
	MaxAccumulatorBytes = 256 << 10
)

// Event is one public SSE frame. Go v1 does not assign SSE id, epoch, or seq.
type Event struct {
	Name companion.PublicEvent
	Text string
	size int
}

func newEvent(name companion.PublicEvent, text string) Event {
	ev := Event{Name: name, Text: text}
	ev.size = encodedLen(ev)
	return ev
}

func (e Event) Size() int {
	if e.size > 0 {
		return e.size
	}
	return encodedLen(e)
}

func (e Event) Terminal() bool {
	switch e.Name {
	case companion.EventCompleted, companion.EventBlocked, companion.EventFailed, companion.EventCancelled:
		return true
	default:
		return false
	}
}

type wireDelta struct {
	Event string `json:"event"`
	Text  string `json:"text"`
}

type wireNamed struct {
	Event string `json:"event"`
}

func (e Event) payload() []byte {
	var raw []byte
	var err error
	switch e.Name {
	case companion.EventDelta, companion.EventSnapshot:
		raw, err = json.Marshal(wireDelta{Event: string(e.Name), Text: e.Text})
	default:
		raw, err = json.Marshal(wireNamed{Event: string(e.Name)})
	}
	if err != nil {
		return []byte(`{"event":"chat.failed"}`)
	}
	return raw
}

// Encode writes one SSE event without an id field.
func Encode(e Event) []byte {
	payload := e.payload()
	buf := make([]byte, 0, 7+len(e.Name)+7+len(payload)+2)
	buf = append(buf, "event: "...)
	buf = append(buf, string(e.Name)...)
	buf = append(buf, '\n')
	buf = append(buf, "data: "...)
	buf = append(buf, payload...)
	buf = append(buf, '\n', '\n')
	return buf
}

func encodedLen(e Event) int {
	return len(Encode(e))
}

// Write encodes and flushes one event to w.
func Write(w io.Writer, e Event) error {
	_, err := w.Write(Encode(e))
	return err
}

// SnapshotEvents is the catch-up/replace payload for the current accumulator.
func SnapshotEvents(acc string) []Event {
	return snapshotEvents(acc)
}

// Named is a public event with no body text (accepted/terminal).
func Named(name companion.PublicEvent) Event {
	return newEvent(name, "")
}

func snapshotEvents(acc string) []Event {
	out := splitNamed(companion.EventSnapshot, acc)
	if len(out) == 0 {
		return []Event{newEvent(companion.EventSnapshot, "")}
	}
	return out
}

func splitNamed(first companion.PublicEvent, text string) []Event {
	if text == "" {
		if first == companion.EventSnapshot {
			return []Event{newEvent(first, "")}
		}
		return nil
	}
	var out []Event
	name := first
	rest := text
	for rest != "" {
		chunk := fit(name, rest, MaxEventBytes)
		if chunk == "" {
			break
		}
		out = append(out, newEvent(name, chunk))
		rest = rest[len(chunk):]
		name = companion.EventDelta
	}
	return out
}

func fit(name companion.PublicEvent, text string, max int) string {
	if text == "" {
		return ""
	}
	chunk := companion.ClampUTF8(text, max)
	for chunk != "" && encodedLen(Event{Name: name, Text: chunk}) > max {
		next := companion.ClampUTF8(chunk, len(chunk)-1)
		if next == chunk {
			if len(chunk) <= 1 {
				return ""
			}
			next = companion.ClampUTF8(chunk, len(chunk)-1)
			if next == chunk {
				return ""
			}
		}
		chunk = next
	}
	return chunk
}

func hasSSEID(b []byte) bool {
	return bytes.Contains(b, []byte("\nid:")) || bytes.HasPrefix(b, []byte("id:"))
}
