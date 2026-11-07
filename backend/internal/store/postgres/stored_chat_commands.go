package postgres

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"reflect"
	"strconv"
	"strings"
)

const (
	StoredChatMutationBytes = 8 << 20
	storedMessageMaxBytes   = 1 << 20
)

type ChatGenerationCommit struct {
	RunID string `json:"generationRunId"`
	State string `json:"state"`
}

// The command envelope is closed. Its three kind-specific objects are decoded
// separately so an edit cannot smuggle append or selection preconditions.
type ChatOperation struct {
	Kind          string          `json:"kind"`
	Target        json.RawMessage `json:"target"`
	Preconditions json.RawMessage `json:"preconditions"`
	Payload       json.RawMessage `json:"payload"`
}
type ChatOperationsRequest struct {
	RequestID      string                `json:"requestId"`
	AuthorityEpoch int64                 `json:"authorityEpoch,string"`
	Operations     []ChatOperation       `json:"operations"`
	Generation     *ChatGenerationCommit `json:"generation,omitempty"`
}
type ChatAppendMessage struct {
	MessageID string   `json:"clientMessageId"`
	Data      ChatData `json:"data"`
}
type ChatAppendRequest struct {
	RequestID      string                `json:"requestId"`
	AuthorityEpoch int64                 `json:"authorityEpoch,string"`
	Messages       []ChatAppendMessage   `json:"messages"`
	Generation     *ChatGenerationCommit `json:"generation,omitempty"`
}
type ChatMessageEditRequest struct {
	RequestID      string                `json:"requestId"`
	AuthorityEpoch int64                 `json:"authorityEpoch,string"`
	BaseRevision   int64                 `json:"baseRevision,string"`
	CandidateID    *string               `json:"candidateId,omitempty"`
	Changes        []ChatFieldChange     `json:"changes"`
	Generation     *ChatGenerationCommit `json:"generation,omitempty"`
}
type ChatMetadataEditRequest struct {
	RequestID      string            `json:"requestId"`
	AuthorityEpoch int64             `json:"authorityEpoch,string"`
	BaseRevision   int64             `json:"baseRevision,string"`
	Changes        []ChatFieldChange `json:"changes"`
}
type ChatDeleteRequest struct {
	RequestID      string `json:"requestId"`
	AuthorityEpoch int64  `json:"authorityEpoch,string"`
	Revision       int64  `json:"chatRevision,string"`
}
type ChatForkRequest struct {
	RequestID      string `json:"requestId"`
	AuthorityEpoch int64  `json:"authorityEpoch,string"`
	ParentRevision int64  `json:"parentRevision,string"`
	ThroughID      string `json:"throughMessageId"`
}
type ChatForkMapping struct {
	ParentMessageID string                     `json:"parentMessageId"`
	MessageID       string                     `json:"messageId"`
	Candidates      []ChatForkCandidateMapping `json:"candidates"`
}
type ChatForkCandidateMapping struct {
	ParentCandidateID string `json:"parentCandidateId"`
	CandidateID       string `json:"candidateId"`
}
type ChatForkResult struct {
	RequestID   string            `json:"requestId"`
	OperationID string            `json:"operationId"`
	Chat        StoredChat        `json:"chat"`
	Mapping     []ChatForkMapping `json:"identityMapping"`
}

// A missing field is different from JSON null. Marshal explicitly so a present
// null participates in both conditional writes and the idempotency digest.
type ChatFieldValue struct {
	Exists bool
	Value  any
}

func (v ChatFieldValue) MarshalJSON() ([]byte, error) {
	if !v.Exists {
		return []byte(`{"exists":false}`), nil
	}
	return json.Marshal(struct {
		Exists bool `json:"exists"`
		Value  any  `json:"value"`
	}{true, v.Value})
}
func (v *ChatFieldValue) UnmarshalJSON(raw []byte) error {
	var wire struct {
		Exists *bool           `json:"exists"`
		Value  json.RawMessage `json:"value"`
	}
	if err := decodeChatObject(raw, &wire, "exists"); err != nil || wire.Exists == nil {
		return ErrInvalid
	}
	if *wire.Exists != (wire.Value != nil) {
		return ErrInvalid
	}
	v.Exists, v.Value = *wire.Exists, nil
	if v.Exists {
		return chatDecode(wire.Value, &v.Value)
	}
	return nil
}

type ChatFieldChange struct {
	Path   []string       `json:"path"`
	Before ChatFieldValue `json:"before"`
	After  ChatFieldValue `json:"after"`
}

func (c *ChatFieldChange) UnmarshalJSON(raw []byte) error {
	type wire ChatFieldChange
	var value wire
	if err := decodeChatObject(raw, &value, "path", "before", "after"); err != nil {
		return err
	}
	*c = ChatFieldChange(value)
	return nil
}

func decodeChatObject(raw []byte, dst any, required ...string) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return ErrInvalid
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return ErrInvalid
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return ErrInvalid
	}
	for _, key := range required {
		if fields[key] == nil {
			return chatError("CHAT_PRECONDITION_REQUIRED")
		}
	}
	return nil
}

type chatCommand struct {
	kind, messageID, candidateID, selectedID, firstID, lastID string
	baseRevision, messageRevision, orderRevision              int64
	changes                                                   []ChatFieldChange
	messages                                                  []ChatAppendMessage
	candidate                                                 *StoredCandidate
	replacement                                               *string
	messageIDs                                                []string
}

func decodeChatCommand(op ChatOperation) (chatCommand, error) {
	c := chatCommand{kind: op.Kind}
	var err error
	root := struct{}{}
	message := struct {
		MessageID string `json:"messageId"`
	}{}
	candidate := struct {
		MessageID   string `json:"messageId"`
		CandidateID string `json:"candidateId"`
	}{}
	base := struct {
		Revision int64 `json:"baseRevision,string"`
	}{}
	revision := struct {
		Revision int64 `json:"messageRevision,string"`
	}{}
	selection := struct {
		Revision int64  `json:"messageRevision,string"`
		Selected string `json:"selectedCandidateId"`
	}{}
	edits := struct {
		Changes []ChatFieldChange `json:"changes"`
	}{}
	switch op.Kind {
	case "edit":
		target := struct {
			MessageID   string  `json:"messageId"`
			CandidateID *string `json:"candidateId,omitempty"`
		}{}
		if err = decodeChatObject(op.Target, &target, "messageId"); err != nil {
			return c, err
		}
		c.messageID = target.MessageID
		if target.CandidateID != nil {
			c.candidateID = *target.CandidateID
			if c.candidateID == "" {
				return c, ErrInvalid
			}
		}
		if err = decodeChatObject(op.Preconditions, &base, "baseRevision"); err == nil {
			err = decodeChatObject(op.Payload, &edits, "changes")
		}
		c.baseRevision, c.changes = base.Revision, edits.Changes
	case "metadata":
		if err = decodeChatObject(op.Target, &root); err == nil {
			err = decodeChatObject(op.Preconditions, &base, "baseRevision")
		}
		if err == nil {
			err = decodeChatObject(op.Payload, &edits, "changes")
		}
		c.baseRevision, c.changes = base.Revision, edits.Changes
	case "append":
		payload := struct {
			Messages []ChatAppendMessage `json:"messages"`
		}{}
		if err = decodeChatObject(op.Target, &root); err == nil {
			err = decodeChatObject(op.Preconditions, &root)
		}
		if err == nil {
			err = decodeChatObject(op.Payload, &payload, "messages")
		}
		c.messages = payload.Messages
	case "delete", "addSwipe":
		if err = decodeChatObject(op.Target, &message, "messageId"); err == nil {
			err = decodeChatObject(op.Preconditions, &revision, "messageRevision")
		}
		c.messageID, c.messageRevision = message.MessageID, revision.Revision
		if op.Kind == "delete" {
			if !bytes.Equal(bytes.TrimSpace(op.Payload), []byte("null")) {
				err = ErrInvalid
			}
		} else {
			payload := struct {
				Candidate struct {
					ID   string   `json:"candidateId"`
					Data ChatData `json:"data"`
				} `json:"candidate"`
			}{}
			if err == nil {
				err = decodeChatObject(op.Payload, &payload, "candidate")
			}
			c.candidate = &StoredCandidate{CandidateID: payload.Candidate.ID, Data: payload.Candidate.Data}
		}
	case "selectSwipe", "removeSwipe":
		if err = decodeChatObject(op.Target, &candidate, "messageId", "candidateId"); err == nil {
			err = decodeChatObject(op.Preconditions, &selection, "messageRevision", "selectedCandidateId")
		}
		c.messageID, c.candidateID, c.selectedID, c.messageRevision = candidate.MessageID, candidate.CandidateID, selection.Selected, selection.Revision
		if op.Kind == "selectSwipe" {
			if !bytes.Equal(bytes.TrimSpace(op.Payload), []byte("null")) {
				err = ErrInvalid
			}
		} else {
			payload := struct {
				Replacement *string `json:"replacementCandidateId"`
			}{}
			if err == nil {
				err = decodeChatObject(op.Payload, &payload, "replacementCandidateId")
			}
			c.replacement = payload.Replacement
		}
	case "insert":
		target := struct {
			Before string `json:"beforeMessageId"`
		}{}
		pre := struct {
			Revision int64 `json:"orderRevision,string"`
		}{}
		payload := struct {
			Messages []ChatAppendMessage `json:"messages"`
		}{}
		if err = decodeChatObject(op.Target, &target, "beforeMessageId"); err == nil {
			err = decodeChatObject(op.Preconditions, &pre, "orderRevision")
		}
		if err == nil {
			err = decodeChatObject(op.Payload, &payload, "messages")
		}
		c.firstID, c.orderRevision, c.messages = target.Before, pre.Revision, payload.Messages
	case "reorder":
		target := struct {
			First string `json:"firstMessageId"`
			Last  string `json:"lastMessageId"`
		}{}
		precondition := struct {
			Revision int64 `json:"orderRevision,string"`
		}{}
		payload := struct {
			IDs []string `json:"messageIds"`
		}{}
		if err = decodeChatObject(op.Target, &target, "firstMessageId", "lastMessageId"); err == nil {
			err = decodeChatObject(op.Preconditions, &precondition, "orderRevision")
		}
		if err == nil {
			err = decodeChatObject(op.Payload, &payload, "messageIds")
		}
		c.firstID, c.lastID, c.orderRevision, c.messageIDs = target.First, target.Last, precondition.Revision, payload.IDs
	default:
		err = chatError("CHAT_INVALID_OPERATION")
	}
	if err != nil {
		return c, err
	}
	for _, id := range []*string{&c.messageID, &c.candidateID, &c.selectedID, &c.firstID, &c.lastID} {
		if *id != "" {
			*id, err = normalizeChatID(*id)
			if err != nil {
				return c, err
			}
		}
	}
	return c, nil
}

func chatPathPrefix(a, b []string) bool {
	if len(a) > len(b) {
		return false
	}
	for i, part := range a {
		if part != b[i] {
			return false
		}
	}
	return true
}

func chatProtectedKey(key string) bool {
	switch key {
	case "vc_f2", "vc_binding", "vc_branch_root", "vc_source", "vc_message_id":
		return true
	}
	return false
}

// Compare JSON structurally without rounding extension-owned integers through
// float64. Numeric spelling does not turn an unchanged field into a conflict.
func equalChatValue(a, b any) bool {
	aRaw, err := json.Marshal(a)
	if err != nil {
		return false
	}
	bRaw, err := json.Marshal(b)
	if err != nil {
		return false
	}
	var aa, bb any
	if chatDecode(aRaw, &aa) != nil || chatDecode(bRaw, &bb) != nil {
		return false
	}
	return equalDecodedChatValue(aa, bb)
}
func equalDecodedChatValue(a, b any) bool {
	switch aa := a.(type) {
	case json.Number:
		bb, ok := b.(json.Number)
		if !ok {
			return false
		}
		return canonicalChatNumber(aa) == canonicalChatNumber(bb)
	case map[string]any:
		bb, ok := b.(map[string]any)
		if !ok || len(aa) != len(bb) {
			return false
		}
		for k, v := range aa {
			other, exists := bb[k]
			if !exists || !equalDecodedChatValue(v, other) {
				return false
			}
		}
		return true
	case []any:
		bb, ok := b.([]any)
		if !ok || len(aa) != len(bb) {
			return false
		}
		for i := range aa {
			if !equalDecodedChatValue(aa[i], bb[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(a, b)
	}
}

// Compare coefficients and exponents without expanding attacker-controlled
// exponents (e.g. 1e999999999). Extension numbers retain their full precision.
func canonicalChatNumber(n json.Number) string {
	s := string(n)
	negative := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	exponent := new(big.Int)
	if at := strings.IndexAny(s, "eE"); at >= 0 {
		exponent.SetString(s[at+1:], 10)
		s = s[:at]
	}
	if at := strings.IndexByte(s, '.'); at >= 0 {
		exponent.Sub(exponent, big.NewInt(int64(len(s)-at-1)))
		s = s[:at] + s[at+1:]
	}
	s = strings.TrimLeft(s, "0")
	if s == "" {
		return "0"
	}
	coefficient := strings.TrimRight(s, "0")
	exponent.Add(exponent, big.NewInt(int64(len(s)-len(coefficient))))
	if negative {
		coefficient = "-" + coefficient
	}
	return coefficient + "e" + exponent.String()
}

// Normalize nested object order, whitespace and numeric spelling before hashing
// an API request. The normalized number remains a JSON number, never a string.
func canonicalChatJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err = chatDecode(raw, &decoded); err != nil {
		return nil, err
	}
	var normalize func(any) any
	normalize = func(v any) any {
		switch typed := v.(type) {
		case json.Number:
			return json.Number(canonicalChatNumber(typed))
		case map[string]any:
			for k, entry := range typed {
				typed[k] = normalize(entry)
			}
		case []any:
			for i, entry := range typed {
				typed[i] = normalize(entry)
			}
		}
		return v
	}
	return json.Marshal(normalize(decoded))
}

func chatPosition(m StoredMessage) int64 {
	position, _ := strconv.ParseInt(m.Position, 10, 64)
	return position
}

func validateChatChangePaths(changes []ChatFieldChange, metadata, candidate bool) error {
	if len(changes) == 0 {
		return chatError("CHAT_INVALID_OPERATION")
	}
	for i, change := range changes {
		path := change.Path
		if len(path) == 0 {
			return chatError("CHAT_INVALID_OPERATION")
		}
		if metadata && path[0] != "title" && path[0] != "header" && path[0] != "metadata" {
			return chatError("CHAT_INVALID_OPERATION")
		}
		if !metadata {
			switch path[0] {
			case "swipes", "swipe_id", "swipe_info":
				return chatError("CHAT_INVALID_OPERATION")
			case "mes", "extra", "variables", "send_date", "gen_started", "gen_finished":
				if !candidate {
					return chatError("CHAT_INVALID_OPERATION")
				}
			}
		}
		for j, key := range path {
			if key == "" || key == "__proto__" || key == "prototype" || key == "constructor" || chatProtectedKey(key) {
				return chatError("CHAT_INVALID_OPERATION")
			}
			// These are real shared script state trees. Changing an ancestor is
			// allowed with its whole-value before guard; merging a leaf is not.
			if j < len(path)-1 && (key == "variables" || key == "stat_data" || key == "display_data" || strings.HasPrefix(key, "vc_story")) {
				return chatError("CHAT_INVALID_OPERATION")
			}
		}
		for _, previous := range changes[:i] {
			if chatPathPrefix(path, previous.Path) || chatPathPrefix(previous.Path, path) {
				return chatError("CHAT_INVALID_OPERATION")
			}
		}
	}
	return nil
}

func chatFieldParent(data ChatData, path []string) (ChatData, bool) {
	parent := data
	for _, key := range path[:len(path)-1] {
		parent = asChatData(parent[key])
		if parent == nil {
			return nil, false
		}
	}
	return parent, true
}

// Replacing an ancestor cannot replace, inject or remove a protected identity.
func sameChatProtectedValues(before, after any) bool {
	a, b := asChatData(before), asChatData(after)
	keys := map[string]struct{}{}
	for k := range a {
		keys[k] = struct{}{}
	}
	for k := range b {
		keys[k] = struct{}{}
	}
	for k := range keys {
		av, aok := a[k]
		bv, bok := b[k]
		if chatProtectedKey(k) {
			if aok != bok || !equalChatValue(av, bv) {
				return false
			}
		} else if !sameChatProtectedValues(av, bv) {
			return false
		}
	}
	return true
}

func checkChatFieldChanges(data ChatData, changes []ChatFieldChange) error {
	for _, change := range changes {
		parent, ok := chatFieldParent(data, change.Path)
		if !ok {
			return chatError("REVISION_CONFLICT")
		}
		value, exists := parent[change.Path[len(change.Path)-1]]
		if exists != change.Before.Exists || (exists && !equalChatValue(value, change.Before.Value)) {
			return chatError("REVISION_CONFLICT")
		}
		if !sameChatProtectedValues(value, change.After.Value) {
			return chatError("CHAT_INVALID_OPERATION")
		}
	}
	return nil
}

func applyChatFieldChanges(data ChatData, changes []ChatFieldChange) {
	for _, change := range changes {
		parent, _ := chatFieldParent(data, change.Path) // Already validated against the start state.
		key := change.Path[len(change.Path)-1]
		if change.After.Exists {
			parent[key] = change.After.Value
		} else {
			delete(parent, key)
		}
	}
}
