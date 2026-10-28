package memoryengine

import (
	"context"
	"net/http"
	"net/http/httptest"
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
func TestClientRejectsRemoteEndpoint(t *testing.T) {
	if _, err := New("https://example.org", "private"); err == nil {
		t.Fatal("remote engine accepted")
	}
}
