package httpapi

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxLabelRunes = 32

var knownPersonas = map[string]struct{}{
	"gentle-listener": {},
}

var knownReplyLength = map[string]struct{}{"SHORT": {}, "MEDIUM": {}, "LONG": {}}
var knownInitiative = map[string]struct{}{"LOW": {}, "MEDIUM": {}, "HIGH": {}}
var knownHumor = map[string]struct{}{"NONE": {}, "LIGHT": {}, "WARM": {}}
var knownAdvice = map[string]struct{}{"ASK_FIRST": {}, "DIRECT": {}, "RARE": {}}
var knownAvoid = map[string]struct{}{
	"WORK": {}, "FAMILY": {}, "HEALTH": {}, "ROMANCE": {},
	"MONEY": {}, "POLITICS": {}, "SUBSTANCE": {}, "RELIGION": {},
}
var knownMemoryShare = map[string]struct{}{"SESSION": {}, "RELATIONSHIP": {}}
var knownGender = map[string]struct{}{"FEMALE": {}, "MALE": {}, "NEUTRAL": {}}
var knownAvatar = map[string]struct{}{
	"AVATAR_FEMALE_01": {}, "AVATAR_MALE_01": {}, "AVATAR_NEUTRAL_01": {},
}

func knownPersona(code string) bool {
	_, ok := knownPersonas[code]
	return ok
}

func catalogHas(set map[string]struct{}, code string) bool {
	_, ok := set[code]
	return ok
}

func sanitizeLabel(raw string) (string, bool) {
	if raw == "" {
		return "", true
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f || unicode.IsControl(r) {
			return "", false
		}
	}
	collapsed := strings.Join(strings.Fields(raw), " ")
	if collapsed == "" {
		return "", true
	}
	if utf8.RuneCountInString(collapsed) > maxLabelRunes {
		return "", false
	}
	return collapsed, true
}
