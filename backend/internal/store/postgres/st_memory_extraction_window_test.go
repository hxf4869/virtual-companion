package postgres

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestBoundExtractionWindow(t *testing.T) {
	rows := make([]extractionSource, 8)
	for i := range rows {
		rows[i] = extractionSource{EngineExtractionMessage: EngineExtractionMessage{ID: fmt.Sprint(i), Role: "user", Content: "事实"}, eligible: true}
	}
	rows[0].Role = "user"
	rows[1].Role = "assistant"
	got := boundExtractionWindow(rows)
	if len(got) != 6 || got[5].ID != "0" || got[4].Role != "assistant" {
		t.Fatalf("window order/bound: %+v", got)
	}
	rows[2].eligible = false
	if got = boundExtractionWindow(rows); len(got) != 2 {
		t.Fatalf("crossed ineligible source: %d", len(got))
	}
	rows[1].Content = strings.Repeat("x", extractionWindowBytes)
	if got = boundExtractionWindow(rows); len(got) != 1 {
		t.Fatalf("oversized context included: %d", len(got))
	}
	rows[0].Role = "assistant"
	if got = boundExtractionWindow(rows); len(got) != 0 {
		t.Fatal("assistant used as anchor")
	}
}

func TestEngineRecoveryRequiresCompleteEvidence(t *testing.T) {
	for _, tc := range []struct {
		name             string
		actual, expected []string
		want             bool
	}{
		{"joint missing B", []string{"ref-a"}, []string{"ref-a", "ref-b"}, false},
		{"legacy missing B", []string{"source-a"}, []string{"source-a", "source-b"}, false},
		{"independent", []string{"ref-a"}, []string{"ref-a"}, true},
		{"complete reordered", []string{"ref-b", "ref-a"}, []string{"ref-a", "ref-b"}, true},
		{"unverifiable", []string{"ref-a"}, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameEngineEvidence(tc.actual, tc.expected); got != tc.want {
				t.Fatalf("complete=%v want %v", got, tc.want)
			}
		})
	}
}

func TestEnginePublicationKeepsLegacyTargetsExplicit(t *testing.T) {
	raw := json.RawMessage(`{"records":[{"id":"replacement","source_message_ids":["new","old"],"nativeField":{"kept":true}}],"targets":[{"id":"old-a","version":1},{"id":"old-b","version":2}],"vectors":[[1,0]]}`)
	normalized, err := enginePublicationProposal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var proposal struct {
		Records []struct {
			ConflictTargetIDs []string
			NativeField       map[string]bool
		}
		Vectors [][]int
	}
	if err := json.Unmarshal(normalized, &proposal); err != nil {
		t.Fatal(err)
	}
	if len(proposal.Records) != 1 || !reflect.DeepEqual(proposal.Records[0].ConflictTargetIDs, []string{"old-a", "old-b"}) || !proposal.Records[0].NativeField["kept"] || !reflect.DeepEqual(proposal.Vectors, [][]int{{1, 0}}) {
		t.Fatal("legacy target mapping or native fields lost")
	}
	current := json.RawMessage(`{"contextDependencies":["new"],"records":[{"id":"replacement","conflictTargetIds":["old-a"]}],"targets":[{"id":"old-a","version":1}]}`)
	normalized, err = enginePublicationProposal(current)
	if err != nil || string(normalized) != string(current) {
		t.Fatalf("current per-record mapping changed: %v", err)
	}
}
