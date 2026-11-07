package postgres

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

func cloneChatData(data ChatData) (ChatData, error) {
	raw, err := chatJSON(data)
	if err != nil || data == nil {
		return nil, ErrInvalid
	}
	var copied ChatData
	err = chatDecode(raw, &copied)
	return copied, err
}

func chatBoolean(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case json.Number:
		return canonicalChatNumber(v) != "0"
	default:
		return true
	}
}

func candidateIndex(m StoredMessage, id string) int {
	for i := range m.Candidates {
		if m.Candidates[i].CandidateID == id {
			return i
		}
	}
	return -1
}

func sourceCandidateData(shared ChatData, candidate StoredCandidate) ChatData {
	extra := asChatData(candidate.Data["extra"])
	source := asChatData(extra["vc_source"])
	signature := ChatData{
		"text": candidate.Data["mes"], "user": chatBoolean(shared["is_user"]),
		"hidden": chatBoolean(shared["is_system"]), "noMemory": chatBoolean(extra["no_memory"]),
		"sourceTimestamp": source["sourceTimestamp"], "sourceTimezone": source["sourceTimezone"],
	}
	if value, exists := shared["name"]; exists {
		signature["name"] = value
	}
	if value, exists := extra["type"]; exists {
		signature["type"] = value
	}
	if value, exists := candidate.Data["variables"]; exists {
		signature["variables"] = value
	}
	return signature
}

func decorateStoredCandidate(c *StoredCandidate) {
	extra := copyChatData(asChatData(c.Data["extra"]))
	source := copyChatData(asChatData(extra["vc_source"]))
	source["id"], source["revision"], source["generation"], source["settled"] = c.CandidateID, c.SourceRevision, c.SourceGeneration, c.settled
	extra["vc_source"] = source
	c.Data["extra"] = extra
}

func newStoredCandidate(id string, input ChatData, settled bool) (StoredCandidate, error) {
	var c StoredCandidate
	var err error
	c.CandidateID, err = normalizeChatID(id)
	if err != nil || input == nil {
		return c, ErrInvalid
	}
	c.Data, err = cloneChatData(input)
	if err != nil {
		return c, err
	}
	if !sameChatProtectedValues(nil, c.Data) {
		return c, chatError("CHAT_INVALID_OPERATION")
	}
	if _, ok := c.Data["mes"].(string); !ok {
		return c, chatError("CHAT_INVALID_OPERATION")
	}
	extra := asChatData(c.Data["extra"])
	if extra == nil {
		if _, exists := c.Data["extra"]; exists {
			return c, chatError("CHAT_INVALID_OPERATION")
		}
		extra = ChatData{}
	}
	// Source time is captured only when creating the identity. Later display-time
	// edits do not rewrite evidence time or silently adopt the server's timezone.
	var instant any
	if sent, ok := c.Data["send_date"].(string); ok {
		if parsed, err := time.Parse(time.RFC3339Nano, sent); err == nil {
			instant = parsed.UTC().Format(time.RFC3339Nano)
		}
	}
	extra["vc_source"] = ChatData{"sourceTimestamp": instant, "sourceTimezone": ""}
	c.Data["extra"] = extra
	c.SourceRevision, c.SourceGeneration, c.settled = 1, 1, settled
	decorateStoredCandidate(&c)
	return c, nil
}

func splitNewStoredMessage(in ChatAppendMessage, position int64, settled bool) (StoredMessage, error) {
	m := StoredMessage{Revision: 1, Position: strconv.FormatInt(position, 10), View: "full"}
	var err error
	m.MessageID, err = normalizeChatID(in.MessageID)
	if err != nil {
		return m, err
	}
	data, err := cloneChatData(in.Data)
	if err != nil {
		return m, err
	}
	// Public append uses clientMessageId for identity. Protected data must be
	// removed by a copy-as-new client, never imported as trusted authority.
	if !sameChatProtectedValues(nil, data) {
		return m, chatError("CHAT_INVALID_OPERATION")
	}
	text, ok := data["mes"].(string)
	if !ok {
		return m, chatError("CHAT_INVALID_OPERATION")
	}
	texts := []any{text}
	if raw, exists := data["swipes"]; exists {
		texts, ok = raw.([]any)
		if !ok || len(texts) == 0 {
			return m, chatError("CHAT_INVALID_OPERATION")
		}
	}
	selected := 0
	if raw, exists := data["swipe_id"]; exists {
		n, ok := raw.(json.Number)
		if !ok {
			return m, chatError("CHAT_INVALID_OPERATION")
		}
		value, err := n.Int64()
		if err != nil || value < 0 || value >= int64(len(texts)) {
			return m, chatError("CHAT_INVALID_OPERATION")
		}
		selected = int(value)
	}
	if texts[selected] != text {
		return m, chatError("CHAT_INVALID_OPERATION")
	}
	var info []any
	if raw, exists := data["swipe_info"]; exists {
		info, ok = raw.([]any)
		if !ok || len(info) > len(texts) {
			return m, chatError("CHAT_INVALID_OPERATION")
		}
	}
	var variablesArray []any
	var variablesMap ChatData
	if raw, exists := data["variables"]; exists {
		variablesArray, ok = raw.([]any)
		if ok {
			if len(variablesArray) > len(texts) {
				return m, chatError("CHAT_INVALID_OPERATION")
			}
		} else {
			variablesMap = asChatData(raw)
			if variablesMap == nil {
				return m, chatError("CHAT_INVALID_OPERATION")
			}
			for key := range variablesMap {
				index, err := strconv.Atoi(key)
				if err != nil || index < 0 || index >= len(texts) || strconv.Itoa(index) != key {
					return m, chatError("CHAT_INVALID_OPERATION")
				}
			}
		}
	}
	for i, rawText := range texts {
		if _, ok := rawText.(string); !ok {
			return m, chatError("CHAT_INVALID_OPERATION")
		}
		cd := ChatData{}
		if i < len(info) {
			cd = asChatData(info[i])
			if cd == nil {
				return m, chatError("CHAT_INVALID_OPERATION")
			}
		}
		cd["mes"] = rawText
		if i == selected {
			if extra, exists := data["extra"]; exists {
				if previous, present := cd["extra"]; present && !equalChatValue(extra, previous) {
					return m, chatError("CHAT_INVALID_OPERATION")
				}
				cd["extra"] = extra
			}
			for _, key := range []string{"send_date", "gen_started", "gen_finished"} {
				if value, exists := data[key]; exists {
					if old, present := cd[key]; present && !equalChatValue(old, value) {
						return m, chatError("CHAT_INVALID_OPERATION")
					}
					cd[key] = value
				}
			}
		} else if _, exists := cd["send_date"]; !exists {
			if value, exists := data["send_date"]; exists {
				cd["send_date"] = value
			}
		}
		if i < len(variablesArray) {
			cd["variables"] = variablesArray[i]
		} else if value, exists := variablesMap[strconv.Itoa(i)]; exists {
			cd["variables"] = value
		}
		candidate, err := newStoredCandidate(chatUUID(), cd, settled)
		if err != nil {
			return m, err
		}
		candidate.everSelected = i == selected
		m.Candidates = append(m.Candidates, candidate)
	}
	m.CandidateCount, m.SelectedCandidateID = len(m.Candidates), m.Candidates[selected].CandidateID
	for _, key := range []string{"mes", "extra", "swipes", "swipe_id", "swipe_info", "variables", "send_date", "gen_started", "gen_finished"} {
		delete(data, key)
	}
	data["vc_message_id"] = m.MessageID
	m.Data = data
	return m, validateStoredMessageDocument(m)
}

func validateStoredMessageDocument(m StoredMessage) error {
	if len(m.Candidates) == 0 || candidateIndex(m, m.SelectedCandidateID) < 0 || m.Data == nil {
		return chatError("CHAT_INVALID_OPERATION")
	}
	seen := map[string]bool{}
	for _, candidate := range m.Candidates {
		if seen[candidate.CandidateID] {
			return chatError("CHAT_INVALID_OPERATION")
		}
		seen[candidate.CandidateID] = true
		if _, ok := candidate.Data["mes"].(string); !ok || asChatData(candidate.Data["extra"]) == nil {
			return chatError("CHAT_INVALID_OPERATION")
		}
	}
	full, err := projectStoredMessage(m, "full")
	if err != nil {
		return err
	}
	encoded, err := chatJSON(full)
	if err != nil {
		return ErrInvalid
	}
	if len(encoded) > storedMessageMaxBytes {
		return chatError("CHAT_PAYLOAD_TOO_LARGE")
	}
	return nil
}

func normalizeCommandIDs(c *chatCommand) error {
	var err error
	if c.candidate != nil {
		c.candidate.CandidateID, err = normalizeChatID(c.candidate.CandidateID)
		if err != nil || c.candidate.Data == nil {
			return ErrInvalid
		}
	}
	if c.replacement != nil {
		id, err := normalizeChatID(*c.replacement)
		if err != nil {
			return err
		}
		c.replacement = &id
	}
	for i := range c.messageIDs {
		c.messageIDs[i], err = normalizeChatID(c.messageIDs[i])
		if err != nil {
			return err
		}
	}
	for i := range c.messages {
		c.messages[i].MessageID, err = normalizeChatID(c.messages[i].MessageID)
		if err != nil || c.messages[i].Data == nil {
			return ErrInvalid
		}
	}
	if c.messageID == "" && c.kind != "metadata" && c.kind != "append" && c.kind != "insert" && c.kind != "reorder" {
		return ErrInvalid
	}
	if (c.kind == "selectSwipe" || c.kind == "removeSwipe") && (c.candidateID == "" || c.selectedID == "") {
		return ErrInvalid
	}
	if c.kind == "reorder" && (c.firstID == "" || c.lastID == "" || len(c.messageIDs) == 0) {
		return ErrInvalid
	}
	if c.kind == "insert" && c.firstID == "" {
		return ErrInvalid
	}
	if (c.kind == "append" || c.kind == "insert") && (len(c.messages) < 1 || len(c.messages) > 100) {
		return chatError("CHAT_INVALID_OPERATION")
	}
	return nil
}

func storedChatResource(method, chatID, suffix string) string {
	return method + " /api/v1/chats/" + strings.ToLower(chatID) + suffix
}
