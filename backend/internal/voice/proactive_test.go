package voice

import (
	"context"
	"testing"
	"time"
)

func TestProactiveLeadTimeSceneAndFastSelection(t *testing.T) {
	store := &testStore{settings: DefaultSettings(), rel: Relationship{ID: 2, Gender: "FEMALE", RelationshipPrefs: RelationshipPrefs{Speed: 1, ProactiveVoice: true}}}
	s := New(map[string]Engine{Kokoro: &testEngine{}, CosyVoice: &testEngine{onlyDefault: true}}, nil, nil, "", nil)
	s.BindStore(store)
	now := time.Now()
	in := CreateRequest{MessageRef: "proactive:1", Purpose: "proactive", Text: "合成主动消息"}
	if _, err := s.PrepareProactive(context.Background(), 1, 2, in, "good_morning", now.Add(4*time.Minute), now); err != ErrUnavailable {
		t.Fatal("short CosyVoice lead accepted")
	}
	clip, err := s.PrepareProactive(context.Background(), 1, 2, in, "good_morning", now.Add(5*time.Minute), now)
	if err != nil || clip.Params.Instructions != store.settings.CosyVoiceInstructions["morning"] {
		t.Fatal("morning scene not applied", err)
	}
	fast := Kokoro
	store.rel.ProactiveEngine = &fast
	clip, err = s.PrepareProactive(context.Background(), 1, 2, in, "good_night", now, now)
	if err != nil || clip.Engine != Kokoro || clip.Params.Instructions != "" {
		t.Fatal("fast proactive selection rejected", err)
	}
	store.existing = &clip
	store.settings.KokoroEnabled = false
	if _, err = s.PrepareProactive(context.Background(), 1, 2, in, "good_night", now, now); err != nil {
		t.Fatal("retry lost durable choice", err)
	}
	if ProactiveScene("share_day") != "share" || ProactiveScene("cold_hello") != "default" {
		t.Fatal("scene mapping")
	}
}
