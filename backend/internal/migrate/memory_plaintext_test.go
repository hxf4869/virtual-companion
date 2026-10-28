package migrate

import (
	"errors"
	"strings"
	"testing"
)

func TestMemoryPlaintextConversionFailsClosed(t *testing.T) {
	for _, stored := range []string{"enc1:bad", "enc2:unknown:1:bad"} {
		if _, err := memoryPlaintext(stored, nil); err == nil {
			t.Fatal("encrypted data accepted without keys")
		}
		_, err := memoryPlaintext(stored, func(string) (string, error) { return "", errors.New("sensitive-value") })
		if err == nil || strings.Contains(err.Error(), "sensitive-value") {
			t.Fatal("decrypt error was not sanitized")
		}
	}
	for _, stored := range []string{"", "普通文本", `{"eventDate":"2026-10-30"}`} {
		got, err := memoryPlaintext(stored, func(string) (string, error) { t.Fatal("plaintext passed to cipher"); return "", nil })
		if err != nil || got != stored {
			t.Fatal("plaintext changed")
		}
	}
}
