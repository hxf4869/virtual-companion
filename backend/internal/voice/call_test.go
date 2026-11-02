package voice

import (
	"context"
	"testing"
	"time"
)

func TestIncomingCallUsesConfiguredChatVoiceAndHonorsVoiceOptOut(t *testing.T) {
	store := &testStore{settings: DefaultSettings(), rel: Relationship{ID: 2, Gender: "FEMALE", RelationshipPrefs: RelationshipPrefs{Speed: 1, ProactiveVoice: true}}}
	s := New(map[string]Engine{Kokoro: &testEngine{}}, nil, nil, "", &testASR{})
	s.BindStore(store)
	if ok, err := s.CallAvailable(context.Background(), 1, 2); err != nil || !ok {
		t.Fatal("configured call unavailable", ok, err)
	}
	off := "OFF"
	store.rel.VoiceFrequency = &off
	if ok, _ := s.CallAvailable(context.Background(), 1, 2); ok {
		t.Fatal("disabled relationship rang")
	}
	store.rel.VoiceFrequency = nil
	store.settings.VoiceFrequency = "OFF"
	if ok, _ := s.CallAvailable(context.Background(), 1, 2); ok {
		t.Fatal("inherited global voice opt-out rang")
	}
	store.settings.VoiceFrequency = "STANDARD"
	now := time.Now()
	clip, err := s.PrepareProactive(context.Background(), 1, 2, CreateRequest{MessageRef: "proactive:1", Text: "合成来电开场", Purpose: "proactive"}, "call", now, now)
	if err != nil || clip.Engine != Kokoro {
		t.Fatal("call voicemail did not use chat engine", clip.Engine, err)
	}
}
