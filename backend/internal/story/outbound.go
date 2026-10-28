package story

import (
	"errors"
	"strings"
	"unicode"
)

// ErrOutboundRejected is the only content refusal. The text is fixed and
// carries no fact, marker, or request body.
var ErrOutboundRejected = errors.New("story outbound rejected")

// CheckOutbound decides whether extracted final-request text may leave for
// actorID. remoteHistory is set when the body still has previous_response_id
// or a provider conversation. Comparison ignores whitespace, width, letter
// case, and punctuation, so inserted spaces or fullwidth forms still match.
// A refusal never identifies which text matched.
func CheckOutbound(caseID, actorID string, texts []string, remoteHistory bool) error {
	def, err := load(caseID)
	if err != nil {
		return err
	}
	if !knownActor(def, actorID) {
		return ErrUnknownActor
	}
	if remoteHistory {
		return ErrOutboundRejected
	}
	var corpus strings.Builder
	for _, text := range texts {
		corpus.WriteString(text)
	}
	normalized := normalizeOutbound(corpus.String())
	for _, secret := range hiddenFor(def, actorID) {
		needle := normalizeOutbound(secret)
		if needle == "" {
			continue
		}
		if strings.Contains(normalized, needle) {
			return ErrOutboundRejected
		}
	}
	return nil
}

func hiddenFor(def definition, actorID string) []string {
	out := make([]string, 0, len(def.Private)*2+len(def.GM.Timeline)+4)
	add := func(text string) {
		if strings.TrimSpace(text) != "" {
			out = append(out, text)
		}
	}
	add(def.GM.Marker)
	add(def.GM.Motive)
	add(def.GM.WatchLocation)
	for _, item := range def.GM.Timeline {
		add(item.Fact)
	}
	for _, item := range def.Private {
		if contains(item.KnownBy, actorID) {
			continue
		}
		add(item.Fact)
		add(item.Marker)
	}
	return out
}

// normalizeOutbound folds fullwidth ASCII, drops whitespace and format
// characters, ignores punctuation, and lowercases ASCII letters.
func normalizeOutbound(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		r = foldWidth(r)
		if r >= 'A' && r <= 'Z' {
			r = r - 'A' + 'a'
		}
		if r < 0x80 {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
				b.WriteByte(byte(r))
			}
			continue
		}
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) || unicode.IsControl(r) || unicode.Is(unicode.M, r) || unicode.Is(unicode.Cf, r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func foldWidth(r rune) rune {
	switch {
	case r >= 0xFF01 && r <= 0xFF5E:
		return r - 0xFEE0
	case r == 0x3000:
		return ' '
	default:
		return r
	}
}
