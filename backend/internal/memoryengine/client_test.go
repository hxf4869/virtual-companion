package memoryengine

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientDoesNotReplayTimeoutOrExposeBody(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer private" {
			t.Error("missing authentication")
		}
		w.WriteHeader(409)
		_, _ = w.Write([]byte("secret source"))
	}))
	defer srv.Close()
	c, err := New(srv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	err = c.Call(context.Background(), "commit", map[string]string{}, nil)
	if err != ErrConflict || calls != 1 {
		t.Fatalf("result %v calls %d", err, calls)
	}
}
func TestClientKeepsOnlyClosedEngineCodes(t *testing.T) {
	secret := "secret dialogue"
	accepted := "MEMORYCORE_" + strings.Repeat("A", 53)
	if len(accepted) != 64 {
		t.Fatalf("fixture length %d", len(accepted))
	}
	cases := []struct {
		name string
		body string
		want string
	}{
		{"tool", `{"code":"MEMORYCORE_TOOL_PATH","detail":"` + secret + `"}`, "MEMORYCORE_TOOL_PATH"},
		{"max", `{"code":"` + accepted + `"}`, accepted},
		{"long", `{"code":"` + accepted + `A"}`, ""},
		{"lower", `{"code":"MEMORYCORE_tool_path"}`, ""},
		{"path", `{"code":"../etc/passwd"}`, ""},
		{"text", secret, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(422)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			c, err := New(srv.URL, "private")
			if err != nil {
				t.Fatal(err)
			}
			err = c.Call(context.Background(), "rebuild-profile", map[string]string{}, nil)
			if ClosedCode(err) != tc.want || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "passwd") {
				t.Fatalf("code %q err %q", ClosedCode(err), err.Error())
			}
			if tc.want == "" && !errors.Is(err, ErrUnavailable) {
				t.Fatalf("open code not discarded: %v", err)
			}
			if tc.want != "" && errors.Is(err, ErrUnavailable) {
				t.Fatal("closed code collapsed")
			}
		})
	}
}
func TestClientRejectsRemoteEndpoint(t *testing.T) {
	if _, err := New("https://example.org", "private"); err == nil {
		t.Fatal("remote engine accepted")
	}
}
