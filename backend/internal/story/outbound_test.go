package story

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestCheckOutboundRejectsHiddenFactsMarkersAndRemoteHistory(t *testing.T) {
	zhou := "自己把怀表藏在维修柜，钥匙还在自己手里。"
	gm := "周澈因维修报酬争议擅自暂藏怀表。"
	lin := "19:55把维修柜钥匙借给周澈，并有借用记录。"
	for _, variant := range []string{
		zhou,
		spaceEvery(zhou),
		strings.ReplaceAll(strings.ReplaceAll(zhou, "，", ","), "。", "."),
		insertRune(zhou, '\u3000'),
		insertRune(zhou, '\u200b'),
		gm,
		spaceEvery(gm),
		"PRIVATE_ZHOU_WATCH_44",
		"private zhou watch 44",
		fullwidthASCII("PRIVATE_ZHOU_WATCH_44"),
		"GM_ONLY_WATCH_TRUTH_92",
		"gm only watch truth 92",
		"workshop_cabinet",
		"周澈取走怀表并藏在维修柜。",
		"20:13只看见蓝色衣袖进入维修间，没有看清脸。",
		"PRIVATE_SU_WITNESS_57",
	} {
		err := CheckOutbound("rainy-inn-v1", "lin", []string{"玩家问：" + variant}, false)
		if !errors.Is(err, ErrOutboundRejected) {
			t.Fatalf("lin accepted hidden text %q: %v", variant, err)
		}
		if err.Error() != "story outbound rejected" {
			t.Fatalf("rejection error = %q", err.Error())
		}
		assertNoEcho(t, err.Error())
	}

	own := []string{
		lin,
		"PRIVATE_LIN_LOAN_31",
		spaceEvery(lin),
		fullwidthASCII(lin),
		"雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。",
	}
	if err := CheckOutbound("rainy-inn-v1", "lin", own, false); err != nil {
		t.Fatalf("lin own knowledge rejected: %v", err)
	}

	// A fact split across the plugin's text buckets is still the same fact.
	split := CheckOutbound("rainy-inn-v1", "lin", []string{"自己把怀表藏在维修柜", "钥匙还在自己手里。"}, false)
	if !errors.Is(split, ErrOutboundRejected) {
		t.Fatalf("split fact err=%v", split)
	}

	view, err := ActorView("rainy-inn-v1", Scope{
		ConversationID: 7, RunID: 11, BranchID: 13, ActorID: "lin", WorldVersion: 0,
	}, []Event{{
		ID: 2, ActorID: "lin", WorldVersion: 0, Visibility: []string{"lin"},
		Body: json.RawMessage(`{"note":"PRIVATE_LIN_LOAN_31"}`),
	}})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckOutbound("rainy-inn-v1", "lin", []string{string(raw)}, false); err != nil {
		t.Fatalf("lin ActorView rejected: %v", err)
	}
	zhouView, err := ActorView("rainy-inn-v1", Scope{
		ConversationID: 7, RunID: 11, BranchID: 13, ActorID: "zhou", WorldVersion: 0,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	zhouRaw, err := json.Marshal(zhouView)
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckOutbound("rainy-inn-v1", "lin", []string{string(zhouRaw)}, false); !errors.Is(err, ErrOutboundRejected) {
		t.Fatalf("lin accepted zhou view: %v", err)
	}
	if err := CheckOutbound("rainy-inn-v1", "zhou", []string{string(zhouRaw), zhou}, false); err != nil {
		t.Fatalf("zhou own view rejected: %v", err)
	}

	err = CheckOutbound("rainy-inn-v1", "lin", []string{"玩家问怀表。"}, true)
	if !errors.Is(err, ErrOutboundRejected) {
		t.Fatalf("remote history err=%v", err)
	}
	assertNoEcho(t, err.Error())
}

func assertNoEcho(t *testing.T, body string) {
	t.Helper()
	for _, secret := range outboundOracleSecrets(t) {
		if strings.Contains(body, secret) {
			t.Fatalf("text contains %s: %s", secret, body)
		}
	}
}

func outboundOracleSecrets(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile("cases/rainy-inn-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Actors []struct {
			Goal string `json:"goal"`
		} `json:"actors"`
		GM struct {
			Marker        string `json:"marker"`
			Motive        string `json:"motive"`
			WatchLocation string `json:"watch_location"`
			Timeline      []struct {
				Fact string `json:"fact"`
			} `json:"timeline"`
		} `json:"gm_truth"`
		Private []struct {
			Fact   string `json:"fact"`
			Marker string `json:"marker"`
		} `json:"initial_private_knowledge"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	out := []string{doc.GM.Marker, doc.GM.Motive, doc.GM.WatchLocation}
	for _, item := range doc.GM.Timeline {
		out = append(out, item.Fact)
	}
	for _, item := range doc.Private {
		out = append(out, item.Fact, item.Marker)
	}
	for _, actor := range doc.Actors {
		if actor.Goal != "" {
			out = append(out, actor.Goal)
		}
	}
	return out
}

func spaceEvery(s string) string {
	var b strings.Builder
	for i, r := range s {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func insertRune(s string, extra rune) string {
	var b strings.Builder
	for i, r := range s {
		if i > 0 {
			b.WriteRune(extra)
		}
		b.WriteRune(r)
	}
	return b.String()
}

func fullwidthASCII(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '!' && r <= '~' {
			b.WriteRune(r + 0xFEE0)
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
