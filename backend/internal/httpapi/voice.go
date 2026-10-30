package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/voice"
)

func (s *Server) registerVoice() {
	s.mux.HandleFunc("GET /api/v1/voice/engines", s.handleVoiceEngines)
	s.mux.HandleFunc("GET /api/v1/voice/settings", s.handleVoiceSettings)
	s.mux.HandleFunc("PUT /api/v1/voice/settings", s.handleSaveVoiceSettings)
	s.mux.HandleFunc("POST /api/v1/relationships/{relationshipId}/voice-clips", s.handleCreateVoiceClip)
	s.mux.HandleFunc("GET /api/v1/voice-clips/{clipId}", s.handleVoiceClip)
	s.mux.HandleFunc("GET /api/v1/voice-clips/{clipId}/audio", s.handleVoiceAudio)
	s.mux.HandleFunc("POST /api/v1/voice/preview", s.handleVoicePreview)
}

func (s *Server) voiceService(w http.ResponseWriter) *voice.Service {
	if s.core.Voice == nil {
		s.writeVoiceError(w, voice.ErrUnavailable)
		return nil
	}
	return s.core.Voice
}

func (s *Server) writeVoiceError(w http.ResponseWriter, err error) {
	status, code, message := http.StatusInternalServerError, "INTERNAL_ERROR", "voice storage unavailable"
	switch {
	case errors.Is(err, voice.ErrInvalid):
		status, code, message = 400, "INVALID_REQUEST", "invalid voice request"
	case errors.Is(err, voice.ErrNotFound):
		status, code, message = 404, "NOT_FOUND_OR_FORBIDDEN", "not found"
	case errors.Is(err, voice.ErrConflict):
		status, code, message = 409, "REVISION_CONFLICT", "voice settings changed"
	case errors.Is(err, voice.ErrRateLimited):
		status, code, message = 429, "RATE_LIMITED", "voice limit reached"
	case errors.Is(err, voice.ErrUnavailable):
		status, code, message = 503, "SCHEMA_UNAVAILABLE", "voice unavailable"
	}
	s.writeAPIError(w, status, code, message)
}

func (s *Server) handleVoiceEngines(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	service := s.voiceService(w)
	if service == nil {
		return
	}
	out, err := service.Engines(r.Context(), p.AccountID)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleVoiceSettings(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	service := s.voiceService(w)
	if service == nil {
		return
	}
	out, err := service.Settings(r.Context(), p.AccountID)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSaveVoiceSettings(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	service := s.voiceService(w)
	if service == nil {
		return
	}
	var in voice.SettingsWrite
	if !s.decodeJSON(w, r, &in) {
		return
	}
	out, err := service.SaveSettings(r.Context(), p.AccountID, in)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateVoiceClip(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	service := s.voiceService(w)
	if service == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeVoiceError(w, voice.ErrInvalid)
		return
	}
	var in voice.CreateRequest
	if !s.decodeJSON(w, r, &in) {
		return
	}
	out, err := service.Create(r.Context(), p.AccountID, id, in)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	s.writeVoiceAccepted(w, out)
}

func (s *Server) handleVoicePreview(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	service := s.voiceService(w)
	if service == nil {
		return
	}
	var in voice.PreviewRequest
	if !s.decodeJSON(w, r, &in) {
		return
	}
	out, err := service.Preview(r.Context(), p.AccountID, in)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	s.writeVoiceAccepted(w, out)
}

func (s *Server) writeVoiceAccepted(w http.ResponseWriter, clip voice.Clip) {
	s.writeJSON(w, http.StatusAccepted, struct {
		ID     int64  `json:"clipId,string"`
		Status string `json:"status"`
	}{clip.ID, clip.Status})
}

func (s *Server) handleVoiceClip(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	service := s.voiceService(w)
	if service == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("clipId"))
	if !ok {
		s.writeVoiceError(w, voice.ErrInvalid)
		return
	}
	out, err := service.Get(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleVoiceAudio(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	service := s.voiceService(w)
	if service == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("clipId"))
	if !ok {
		s.writeVoiceError(w, voice.ErrInvalid)
		return
	}
	clip, err := service.Get(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	if clip.Status == "expired" {
		s.writeAPIError(w, 410, "INVALID_REQUEST", "voice clip expired")
		return
	}
	if clip.Status != "ready" {
		s.writeAPIError(w, 409, "INVALID_REQUEST", "voice clip is not ready")
		return
	}
	data, err := service.Audio(r.Context(), clip)
	if err != nil {
		s.writeVoiceError(w, err)
		return
	}
	start, end, partial, ok := voiceByteRange(r.Header.Get("Range"), len(data))
	if !ok {
		w.Header().Set("Content-Range", "bytes */"+strconv.Itoa(len(data)))
		s.writeAPIError(w, 416, "INVALID_REQUEST", "invalid audio range")
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(end-start+1))
	status := http.StatusOK
	if partial {
		status = 206
		w.Header().Set("Content-Range", "bytes "+strconv.Itoa(start)+"-"+strconv.Itoa(end)+"/"+strconv.Itoa(len(data)))
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data[start : end+1])
	}
}

func voiceByteRange(raw string, size int) (start, end int, partial, ok bool) {
	if size <= 0 {
		return 0, 0, false, false
	}
	if raw == "" {
		return 0, size - 1, false, true
	}
	if !strings.HasPrefix(raw, "bytes=") || strings.Contains(raw, ",") {
		return 0, 0, false, false
	}
	a, b, found := strings.Cut(strings.TrimPrefix(raw, "bytes="), "-")
	if !found {
		return 0, 0, false, false
	}
	for _, part := range []string{a, b} {
		for _, c := range part {
			if c < '0' || c > '9' {
				return 0, 0, false, false
			}
		}
	}
	if a == "" {
		suffix, err := strconv.ParseInt(b, 10, 64)
		if err != nil || suffix <= 0 {
			return 0, 0, false, false
		}
		if suffix > int64(size) {
			suffix = int64(size)
		}
		return size - int(suffix), size - 1, true, true
	}
	first, err := strconv.ParseInt(a, 10, 64)
	if err != nil || first < 0 || first >= int64(size) {
		return 0, 0, false, false
	}
	last := int64(size - 1)
	if b != "" {
		last, err = strconv.ParseInt(b, 10, 64)
		if err != nil || last < first {
			return 0, 0, false, false
		}
	}
	if last >= int64(size) {
		last = int64(size - 1)
	}
	return int(first), int(last), true, true
}
