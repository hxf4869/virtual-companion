package postgres

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestStoredChatConditionalFields(t *testing.T) {
	var present, absent ChatFieldValue
	if json.Unmarshal([]byte(`{"exists":true,"value":null}`), &present) != nil || !present.Exists || present.Value != nil {
		t.Fatal("present null was lost")
	}
	if json.Unmarshal([]byte(`{"exists":false}`), &absent) != nil || absent.Exists {
		t.Fatal("absent field was lost")
	}
	for _, invalid := range []string{`{}`, `null`, `{"exists":true}`, `{"exists":false,"value":null}`, `{"exists":true,"value":1,"extra":1}`} {
		if json.Unmarshal([]byte(invalid), new(ChatFieldValue)) == nil {
			t.Fatal("malformed field-value shape was accepted")
		}
	}
	data := ChatData{"extra": ChatData{"null": nil, "nested": ChatData{"kept": 1}}, "array": []any{1}}
	valid := []ChatFieldChange{{Path: []string{"extra", "null"}, Before: present, After: absent},
		{Path: []string{"extra", "added"}, Before: absent, After: ChatFieldValue{Exists: true, Value: "new"}}}
	if err := checkChatFieldChanges(data, valid); err != nil {
		t.Fatal(err)
	}
	applyChatFieldChanges(data, valid)
	if _, exists := asChatData(data["extra"])["null"]; exists || asChatData(asChatData(data["extra"])["nested"])["kept"] != 1 {
		t.Fatal("conditional write discarded an unknown sibling or failed to remove the field")
	}
	for _, path := range [][]string{{"missing", "child"}, {"array", "0"}} {
		if checkChatFieldChanges(data, []ChatFieldChange{{Path: path}}) == nil {
			t.Fatal("missing/non-object parent was silently created or traversed")
		}
	}
	if checkChatFieldChanges(ChatData{}, []ChatFieldChange{{Path: []string{"null"}, Before: present}}) == nil {
		t.Fatal("missing field matched null")
	}
}

func TestStoredChatFieldPathRightsAndStateTrees(t *testing.T) {
	for _, paths := range [][][]string{
		{{}}, {{"extra", "vc_source", "revision"}}, {{"__proto__"}},
		{{"extra", "a"}, {"extra"}}, {{"variables", "stat_data", "score"}},
		{{"extra", "stat_data", "score"}}, {{"swipes"}},
	} {
		changes := []ChatFieldChange{}
		for _, path := range paths {
			changes = append(changes, ChatFieldChange{Path: path})
		}
		if validateChatChangePaths(changes, false, true) == nil {
			t.Fatal("invalid path/overlap/state-tree leaf accepted")
		}
	}
	if validateChatChangePaths([]ChatFieldChange{{Path: []string{"mes"}}}, false, false) == nil {
		t.Fatal("candidate text inferred from implicit selection")
	}
	if validateChatChangePaths([]ChatFieldChange{{Path: []string{"variables"}}}, false, true) != nil {
		t.Fatal("whole state-tree replacement rejected")
	}
	data := ChatData{"extra": ChatData{"vc_source": ChatData{"id": "server-owned"}, "ui": 1}}
	before := asChatData(data["extra"])
	for _, after := range []any{ChatData{"ui": 2}, ChatData{"vc_source": ChatData{"id": "forged"}}, nil} {
		change := ChatFieldChange{Path: []string{"extra"}, Before: ChatFieldValue{Exists: true, Value: before}, After: ChatFieldValue{Exists: true, Value: after}}
		if checkChatFieldChanges(data, []ChatFieldChange{change}) == nil {
			t.Fatal("ancestor replacement changed a protected identity")
		}
	}
}

func TestStoredChatCanonicalRequestAndNumbers(t *testing.T) {
	a, err := chatDigest(json.RawMessage(`{"operations":[{"payload":{"number":1.00,"large":9007199254740993},"kind":"edit"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := chatDigest(json.RawMessage(`{ "operations" : [{"kind":"edit","payload":{"large":9007199254740993,"number":1e0}}] }`))
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("JSON object order or number spelling changed request identity")
	}
	if equalChatValue(json.Number("9007199254740993"), json.Number("9007199254740992")) {
		t.Fatal("large extension integer was rounded")
	}
	if !equalChatValue(json.Number("1e999999999999999999999"), json.Number("10e999999999999999999998")) {
		t.Fatal("large exponent normalization expanded or changed the value")
	}
}

func TestStoredChatMessageSplitPreservesFullData(t *testing.T) {
	input := ChatAppendMessage{MessageID: "10000000-0000-4000-8000-000000000001", Data: ChatData{
		"name": "Synthetic", "is_user": false, "mes": "second", "swipes": []any{"first", "second"}, "swipe_id": 1,
		"extra": ChatData{"selected": true}, "unknown": ChatData{"nested": 7},
		"send_date": "2026-11-07T02:00:00Z", "gen_started": "2026-11-07T01:59:59Z",
		"swipe_info": []any{ChatData{"send_date": "2026-11-06T02:00:00Z", "extra": ChatData{"first": true}, "unknown_info": "kept"}, ChatData{"extra": ChatData{"selected": true}}},
		"variables":  ChatData{"0": ChatData{"score": 1}, "1": nil},
	}}
	m, err := splitNewStoredMessage(input, 1, true)
	if err != nil {
		t.Fatal(err)
	}
	full, err := projectStoredMessage(m, "full")
	if err != nil || full.Data["mes"] != "second" || !equalChatValue(full.Data["unknown"], input.Data["unknown"]) {
		t.Fatal("shared/full fields did not survive splitting")
	}
	if full.Data["variables"].([]any)[1] != nil || asChatData(full.Data["swipe_info"].([]any)[0])["unknown_info"] != "kept" {
		t.Fatal("candidate unknown fields or null variables were lost")
	}
	m.SelectedCandidateID = m.Candidates[0].CandidateID
	switched, err := projectStoredMessage(m, "full")
	if err != nil || switched.Data["send_date"] != "2026-11-06T02:00:00Z" {
		t.Fatal("candidate time did not follow selection")
	}
	if _, leaked := switched.Data["gen_started"]; leaked {
		t.Fatal("old selected generation timestamp leaked into the new selection")
	}
	if asChatData(input.Data["extra"])["vc_source"] != nil {
		t.Fatal("normalization mutated the caller's request")
	}
	if _, err = splitNewStoredMessage(ChatAppendMessage{MessageID: input.MessageID, Data: ChatData{"mes": "x", "extra": ChatData{"vc_source": ChatData{"id": "forged"}}}}, 1, true); err == nil {
		t.Fatal("public append accepted protected source identity")
	}
	if _, err = splitNewStoredMessage(ChatAppendMessage{MessageID: input.MessageID, Data: ChatData{"mes": strings.Repeat("x", 400<<10)}}, 1, true); err == nil {
		t.Fatal("full message above 1 MiB accepted")
	}
}
