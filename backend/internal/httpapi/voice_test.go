package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/voice"
)

type voiceHTTPStore struct {
	voice.Store
	clip  voice.Clip
	reads int
}

func (s *voiceHTTPStore) GetVoiceClip(_ context.Context, owner, id int64) (voice.Clip, error) {
	s.reads++
	if owner != s.clip.OwnerID || id != s.clip.ID {
		return voice.Clip{}, voice.ErrNotFound
	}
	return s.clip, nil
}

type voiceHTTPBlobs struct {
	voice.BlobStore
	gets int
}

func (b *voiceHTTPBlobs) Get(context.Context, string) ([]byte, error) {
	b.gets++
	return []byte("RIFF_SYNTHETIC_AUDIO"), nil
}

func TestVoiceAudioAuthenticationOwnershipAndRanges(t *testing.T) {
	srv := newCoreServer(t, "full", newMemStore())
	store := &voiceHTTPStore{clip: voice.Clip{OwnerID: 1, ID: 7, Status: "ready", ObjectKey: "private-key"}}
	blobs := &voiceHTTPBlobs{}
	service := voice.New(nil, blobs, nil, "", nil)
	service.BindStore(store)
	srv.core.Voice = service
	request := func(owner int64, rangeHeader string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/voice-clips/7/audio", nil)
		if owner > 0 {
			attachAuth(t, srv, r, owner, false)
		}
		r.Header.Set("Range", rangeHeader)
		w := httptest.NewRecorder()
		srv.Handler().ServeHTTP(w, r)
		return w
	}
	if rec := request(0, ""); rec.Code != 401 {
		t.Fatalf("anonymous status %d", rec.Code)
	}
	if rec := request(2, ""); rec.Code != 404 || blobs.gets != 0 {
		t.Fatal("foreign clip reached storage")
	}
	for _, tc := range []struct {
		header string
		status int
		body   string
	}{
		{"", 200, "RIFF_SYNTHETIC_AUDIO"}, {"bytes=0-3", 206, "RIFF"}, {"bytes=-5", 206, "AUDIO"}, {"bytes=15-", 206, "AUDIO"},
		{"bytes=99-", 416, ""}, {"bytes=0-1,3-4", 416, ""}, {"bytes=+0-1", 416, ""},
	} {
		rec := request(1, tc.header)
		if rec.Code != tc.status {
			t.Fatalf("range %s status %d", tc.header, rec.Code)
		}
		if tc.body != "" && (rec.Body.String() != tc.body || rec.Header().Get("Cache-Control") != "private, no-store") {
			t.Fatal("audio bytes or cache policy incorrect")
		}
		if strings.Contains(rec.Body.String(), "private-key") {
			t.Fatal("object key exposed")
		}
	}
	store.clip.Status = "failed"
	if rec := request(1, ""); rec.Code != 409 {
		t.Fatal("failed clip did not use text fallback state")
	}
	store.clip.Status = "expired"
	if rec := request(1, ""); rec.Code != 410 {
		t.Fatal("expired clip remained playable")
	}
}

func TestVoiceUnavailableAndWriteCSRF(t *testing.T) {
	srv := newCoreServer(t, "full", newMemStore())
	if rec := doJSON(t, srv, "GET", "/api/v1/voice/settings", "", 1); rec.Code != 503 {
		t.Fatal("missing voice service did not fail closed")
	}
	r := httptest.NewRequest("POST", "/api/v1/voice/preview", strings.NewReader(`{}`))
	attachAuth(t, srv, r, 1, false)
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("voice write bypassed origin/CSRF gate")
	}
}
