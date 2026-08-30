package realtime

import (
	"os"
	"strings"
	"testing"
)

func TestPackageDoesNotImportProviderSDK(t *testing.T) {
	t.Parallel()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		b, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		src := string(b)
		if strings.Contains(src, "openai") || strings.Contains(src, "EventSink") || strings.Contains(src, "Last-Event-ID") {
			t.Fatalf("%s leaks provider or ticket resume types", e.Name())
		}
	}
}
