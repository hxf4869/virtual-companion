package modelhttp

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

const (
	MaxMessages     = 64
	MaxMessageBytes = 64 << 10
)

func ValidateRequest(req companion.ModelRequest) error {
	if len(req.Messages) == 0 || len(req.Messages) > MaxMessages || req.MaxTokens < 0 {
		return companion.InvalidRequest()
	}
	for _, m := range req.Messages {
		switch m.Role {
		case companion.RoleSystem, companion.RoleUser, companion.RoleAssistant:
		default:
			return companion.InvalidRequest()
		}
		if m.Content == "" || !utf8.ValidString(m.Content) || len(m.Content) > MaxMessageBytes {
			return companion.InvalidRequest()
		}
	}
	return nil
}

func CredentialValid(value string) bool {
	if len(value) < 1 || len(value) > 4096 || strings.TrimSpace(value) == "" {
		return false
	}
	for _, r := range value {
		if r > 0xff || unicode.IsControl(r) {
			return false
		}
	}
	return true
}
