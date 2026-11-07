package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/jackc/pgx/v5"
)

type preparedTransfer struct {
	MetadataChanged bool                        `json:"metadataChanged"`
	OrderChanged    bool                        `json:"orderChanged"`
	NextPosition    int64                       `json:"nextPosition"`
	Header          ChatData                    `json:"header"`
	Metadata        ChatData                    `json:"metadata"`
	Rows            chattransfer.Manifest       `json:"rows"`
	Intent          ChatTransferIntent          `json:"intent"`
	Mapping         []NativeChatIdentityMapping `json:"mapping"`
	Result          ChatImportResult            `json:"result"`
	IDs             []string                    `json:"ids"`
	ClearReceipts   bool                        `json:"clearReceipts"`
}
type preparedTransferRow struct {
	ID             string                      `json:"id"`
	Position       int64                       `json:"position"`
	Revision       int64                       `json:"revision"`
	Selected       string                      `json:"selected"`
	Data           string                      `json:"data"`
	Candidates     []preparedTransferCandidate `json:"candidates"`
	ContentChanged bool                        `json:"contentChanged"`
	SourceChanged  bool                        `json:"sourceChanged"`
	Projection     ChatData                    `json:"projection"`
}
type preparedTransferCandidate struct {
	ID           string `json:"id"`
	Ordinal      int    `json:"ordinal"`
	Revision     int64  `json:"revision"`
	Generation   int64  `json:"generation"`
	Settled      bool   `json:"settled"`
	EverSelected bool   `json:"everSelected"`
	Data         string `json:"data"`
}

func transferInputIdentities(data ChatData) (*string, []*string, error) {
	var message *string
	if raw, ok := data["vc_message_id"]; ok {
		v, ok := raw.(string)
		if !ok {
			return nil, nil, ErrInvalid
		}
		id, e := normalizeChatID(v)
		if e != nil {
			return nil, nil, e
		}
		message = &id
	}
	n, selected := 1, 0
	if a, ok := data["swipes"].([]any); ok {
		n = len(a)
	}
	if number, ok := data["swipe_id"].(json.Number); ok {
		v, _ := number.Int64()
		selected = int(v)
	}
	ids := make([]*string, n)
	get := func(d ChatData) (*string, error) {
		source := asChatData(asChatData(d["extra"])["vc_source"])
		if source == nil {
			return nil, nil
		}
		raw, ok := source["id"]
		if !ok {
			return nil, nil
		}
		v, ok := raw.(string)
		if !ok {
			return nil, ErrInvalid
		}
		id, e := normalizeChatID(v)
		return &id, e
	}
	info, _ := data["swipe_info"].([]any)
	for i := range ids {
		if i < len(info) {
			v, e := get(asChatData(info[i]))
			if e != nil {
				return nil, nil, e
			}
			ids[i] = v
		}
	}
	outer, e := get(data)
	if e != nil {
		return nil, nil, e
	}
	if outer != nil {
		if ids[selected] != nil && *outer != *ids[selected] {
			return nil, nil, ErrInvalid
		}
		ids[selected] = outer
	}
	return message, ids, nil
}
func stripTransferSource(d ChatData) {
	if extra := asChatData(d["extra"]); extra != nil {
		delete(extra, "vc_source")
	}
}
func stripTransferIdentities(d ChatData) {
	delete(d, "vc_message_id")
	stripTransferSource(d)
	if info, ok := d["swipe_info"].([]any); ok {
		for _, v := range info {
			stripTransferSource(asChatData(v))
		}
	}
}
func countTransferReferences(v any, ids map[string]bool) int64 {
	var count int64
	switch x := v.(type) {
	case string:
		if ids[strings.ToLower(x)] {
			count++
		}
	case ChatData:
		for _, v := range x {
			count += countTransferReferences(v, ids)
		}
	case map[string]any:
		for _, v := range x {
			count += countTransferReferences(v, ids)
		}
	case []any:
		for _, v := range x {
			count += countTransferReferences(v, ids)
		}
	}
	return count
}
func appendTransferIssue(r *ChatImportResult, line int, reason string) {
	if len(r.Issues) < 100 {
		r.Issues = append(r.Issues, chatjsonl.Issue{Line: line, Code: chatjsonl.InvalidCode, Reason: reason})
	} else {
		r.IssuesTruncated = true
	}
}

// Only identity indexes and the acknowledgement mapping grow with message count.
// Bodies pass through encrypted chunks; no whole-chat document slice is retained.
func (s *Store) prepareTransfer(ctx context.Context, owner int64, action string, in NativeChatUpload, manifest chattransfer.Manifest, objects chattransfer.Objects) (preparedTransfer, error) {
	p := preparedTransfer{Mapping: []NativeChatIdentityMapping{}, IDs: []string{}, Result: ChatImportResult{Issues: []chatjsonl.Issue{}}}
	var baseline StoredChat
	originalIDs := []string{}
	if action == "save" {
		var e error
		baseline, e = s.ResolveNativeChat(ctx, owner, in.Scope, in.FileName, in.AuthorityEpoch)
		if e != nil {
			return p, e
		}
		if baseline.ChatID != in.ChatID {
			return p, ErrNotFound
		}
		if baseline.Revision != in.ChatRevision {
			return p, chatError("REVISION_CONFLICT")
		}
		e = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
			if e := tx.QueryRow(ctx, `SELECT next_position FROM vc.stored_chat WHERE owner_user_id=$1 AND chat_id=$2`, owner, in.ChatID).Scan(&p.NextPosition); e != nil {
				return e
			}
			rows, e := tx.Query(ctx, `SELECT message_id::text FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2 AND deleted_at IS NULL ORDER BY position`, owner, in.ChatID)
			if e != nil {
				return e
			}
			defer rows.Close()
			for rows.Next() {
				var id string
				if e = rows.Scan(&id); e != nil {
					return e
				}
				originalIDs = append(originalIDs, id)
			}
			return rows.Err()
		})
		if e != nil {
			return p, e
		}
	}
	known := map[string]bool{}
	seen := map[string]bool{}
	r, e := chattransfer.NewReader(ctx, objects, manifest)
	if e != nil {
		return p, e
	}
	result, e := chatjsonl.Read(r, chatjsonl.Handlers{OnHeader: func(header chatjsonl.Object) error {
		metadata := asChatData(header["chat_metadata"])
		for _, v := range []any{asChatData(metadata["vc_f2"])["id"], asChatData(metadata["vc_binding"])["chatIdentity"], metadata["vc_branch_root"]} {
			if id, ok := v.(string); ok {
				known[strings.ToLower(id)] = true
			}
		}
		return nil
	}, OnMessage: func(line int, raw chatjsonl.Object) error {
		m, cs, e := transferInputIdentities(ChatData(raw))
		if e != nil {
			appendTransferIssue(&p.Result, line, "INVALID_REFERENCE")
			return nil
		}
		all := cs
		if m != nil {
			all = append(append([]*string{}, cs...), m)
		}
		for _, id := range all {
			if id != nil {
				if seen[*id] {
					appendTransferIssue(&p.Result, line, "DUPLICATE_ID")
				}
				known[*id] = true
				seen[*id] = true
			}
		}
		return nil
	}})
	if e != nil {
		return p, e
	}
	p.Result.ValidatedMessages = result.ValidatedMessages
	p.Result.ValidatedCandidates = result.ValidatedCandidates
	for _, issue := range result.Issues {
		if len(p.Result.Issues) < 100 {
			p.Result.Issues = append(p.Result.Issues, issue)
		} else {
			p.Result.IssuesTruncated = true
		}
	}
	p.Result.IssuesTruncated = p.Result.IssuesTruncated || result.IssuesTruncated
	if !result.Valid() || len(p.Result.Issues) > 0 {
		return p, nil
	}
	p.Intent, e = s.BeginChatTransfer(ctx, owner)
	if e != nil {
		return p, e
	}
	writer := chattransfer.NewWriter(ctx, objects, p.Intent.Prefix, 0)
	encoder := json.NewEncoder(writer)
	r, e = chattransfer.NewReader(ctx, objects, manifest)
	if e != nil {
		return p, e
	}

	baselines := map[int]StoredMessage{}
	recordInputFailure := func(line int, err error) bool {
		var ce *ChatError
		if !errors.As(err, &ce) {
			return false
		}
		if ce.Code != "CHAT_PAYLOAD_TOO_LARGE" && ce.Code != "CHAT_INVALID_OPERATION" {
			return false
		}
		reason := "INVALID_MESSAGE"
		code := chatjsonl.InvalidCode
		if ce.Code == "CHAT_PAYLOAD_TOO_LARGE" {
			reason = "MESSAGE_TOO_LARGE"
			code = chatjsonl.TooLargeCode
		}
		if len(p.Result.Issues) < chatjsonl.MaxIssues {
			p.Result.Issues = append(p.Result.Issues, chatjsonl.Issue{Line: line, Code: code, Reason: reason})
		} else {
			p.Result.IssuesTruncated = true
		}
		return true
	}
	processMessage := func(line int, raw chatjsonl.Object) error {
		data := ChatData(raw)
		oldID, oldCandidates, e := transferInputIdentities(data)
		if len(oldCandidates) > chatjsonl.MaxMessageBytes/96 {
			recordInputFailure(line, chatError("CHAT_PAYLOAD_TOO_LARGE"))
			return nil
		}
		if e != nil {
			return e
		}
		before := baselines[line]
		if (action == "save" || action == "fork") && before.MessageID != "" {
			// Source identity and versions are authority, not an editable extension.
			info, _ := data["swipe_info"].([]any)
			for i, id := range oldCandidates {
				if id == nil {
					continue
				}
				at := candidateIndex(before, *id)
				if at < 0 {
					continue
				}
				d := data
				if i < len(info) {
					d = asChatData(info[i])
				}
				source := asChatData(asChatData(d["extra"])["vc_source"])
				prior := asChatData(asChatData(before.Candidates[at].Data["extra"])["vc_source"])
				if !equalChatValue(source, prior) {
					return chatError("CHAT_INVALID_OPERATION")
				}
			}
		}
		if action == "fork" {
			if oldID == nil {
				return chatError("CHAT_INVALID_OPERATION")
			}
			before = StoredMessage{}
		}
		stripTransferIdentities(data)
		p.Result.UnresolvedExtensionReferences += countTransferReferences(data, known)
		id := chatUUID()
		if before.MessageID != "" {
			id = before.MessageID
		}
		m, e := splitNewStoredMessage(ChatAppendMessage{MessageID: id, Data: data}, int64(line-1), in.Generation == nil || in.Generation.State == "settled")
		if e != nil {
			if recordInputFailure(line, e) {
				return nil
			}
			return e
		}
		mapping := NativeChatIdentityMapping{MessageIndex: line - 2, InputMessageID: oldID, MessageID: id, Candidates: []NativeCandidateMapping{}}
		selected := candidateIndex(m, m.SelectedCandidateID)
		for i := range m.Candidates {
			c := &m.Candidates[i]
			if before.MessageID != "" && oldCandidates[i] != nil && candidateIndex(before, *oldCandidates[i]) >= 0 {
				prior := before.Candidates[candidateIndex(before, *oldCandidates[i])]
				c.CandidateID = prior.CandidateID
				c.SourceRevision = prior.SourceRevision
				c.SourceGeneration = prior.SourceGeneration
				c.everSelected = prior.everSelected
				extra := asChatData(c.Data["extra"])
				extra["vc_source"] = copyChatData(asChatData(asChatData(prior.Data["extra"])["vc_source"]))
				if in.Generation == nil {
					c.settled = prior.settled
				}
				if !equalChatValue(sourceCandidateData(before.Data, prior), sourceCandidateData(m.Data, *c)) {
					c.SourceRevision++
				}
				wasSelected := before.SelectedCandidateID == c.CandidateID
				nowSelected := selected == i
				if wasSelected && !nowSelected || nowSelected && (wasSelected && c.SourceRevision != prior.SourceRevision || !wasSelected && prior.everSelected) {
					c.SourceGeneration++
				}
			}
			c.everSelected = c.everSelected || i == selected
			decorateStoredCandidate(c)
			mapping.Candidates = append(mapping.Candidates, NativeCandidateMapping{CandidateIndex: i, InputCandidateID: oldCandidates[i], CandidateID: c.CandidateID, SourceRevision: c.SourceRevision, SourceGeneration: c.SourceGeneration})
		}
		m.SelectedCandidateID = m.Candidates[selected].CandidateID
		m.Data["vc_message_id"] = m.MessageID
		changed := before.MessageID == "" || !sameStoredMessageContent(before, m)
		if before.MessageID != "" {
			m.Revision = before.Revision
			if changed {
				m.Revision++
			}
		}
		sourceChanged := before.MessageID == "" || before.SelectedCandidateID != m.SelectedCandidateID
		if !sourceChanged {
			a, b := before.Candidates[candidateIndex(before, before.SelectedCandidateID)], m.Candidates[selected]
			sourceChanged = a.SourceRevision != b.SourceRevision || a.SourceGeneration != b.SourceGeneration
		}
		if action == "save" && in.Generation == nil && !chatBoolean(m.Data["is_user"]) && changed {
			// Native generated output carries gen timestamps; ordinary manual edits do not.
			for _, c := range m.Candidates {
				if c.Data["gen_started"] != nil || c.Data["gen_finished"] != nil {
					at := candidateIndex(before, c.CandidateID)
					if at < 0 || !equalChatValue(c.Data["gen_started"], before.Candidates[at].Data["gen_started"]) || !equalChatValue(c.Data["gen_finished"], before.Candidates[at].Data["gen_finished"]) {
						return chatError("CHAT_GENERATION_FENCED")
					}
				}
			}
		}
		if e = validateStoredMessageDocument(m); e != nil {
			if recordInputFailure(line, e) {
				return nil
			}
			return e
		}
		cipher, e := s.encodeChatJSON(m.Data)
		if e != nil {
			return e
		}
		position := int64(line - 1)
		if before.MessageID != "" {
			position = chatPosition(before)
		}
		row := preparedTransferRow{ID: id, Position: position, Revision: m.Revision, Selected: m.SelectedCandidateID, Data: cipher, ContentChanged: changed, SourceChanged: sourceChanged, Candidates: []preparedTransferCandidate{}, Projection: storedSourceProjection(m)}
		for i, c := range m.Candidates {
			cipher, e := s.encodeChatJSON(c.Data)
			if e != nil {
				return e
			}
			row.Candidates = append(row.Candidates, preparedTransferCandidate{c.CandidateID, i, c.SourceRevision, c.SourceGeneration, c.settled, c.everSelected, cipher})
		}
		for _, c := range before.Candidates {
			if candidateIndex(m, c.CandidateID) < 0 {
				p.ClearReceipts = true
			}
		}
		if e = encoder.Encode(row); e != nil {
			return e
		}
		p.Mapping = append(p.Mapping, mapping)
		p.IDs = append(p.IDs, id)
		return nil
	}
	type transferPendingMessage struct {
		line int
		raw  chatjsonl.Object
	}
	pending := []transferPendingMessage{}
	pendingBytes := 0
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		if action == "save" || action == "fork" {
			e := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
				for _, entry := range pending {
					id, ids, e := transferInputIdentities(ChatData(entry.raw))
					if e != nil {
						return e
					}
					var before StoredMessage
					parentID := in.ChatID
					if action == "fork" {
						parentID = in.ParentChatID
					}
					if id != nil {
						before, e = s.loadStoredMessage(ctx, tx, owner, parentID, *id)
						if e != nil && !errors.Is(e, ErrNotFound) {
							return e
						}
						if errors.Is(e, ErrNotFound) {
							var used bool
							if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.stored_message WHERE owner_user_id=$1 AND message_id=$2)`, owner, *id).Scan(&used); e != nil {
								return e
							}
							if used || action == "fork" {
								return chatError("CHAT_INVALID_OPERATION")
							}
						}
					}
					for _, candidate := range ids {
						if candidate == nil || candidateIndex(before, *candidate) >= 0 {
							continue
						}
						var used bool
						if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.stored_candidate WHERE owner_user_id=$1 AND candidate_id=$2)`, owner, *candidate).Scan(&used); e != nil {
							return e
						}
						if used || action == "fork" {
							return chatError("CHAT_INVALID_OPERATION")
						}
					}
					baselines[entry.line] = before
				}
				return nil
			})
			if e != nil {
				return e
			}
		}
		for _, entry := range pending {
			if e := processMessage(entry.line, entry.raw); e != nil {
				return e
			}
			delete(baselines, entry.line)
		}
		pending = nil
		pendingBytes = 0
		return nil
	}
	headerHandler := func(h chatjsonl.Object) error {
		p.Header = ChatData(h)
		p.Metadata = asChatData(h["chat_metadata"])
		if p.Metadata == nil {
			p.Metadata = ChatData{}
		}
		delete(p.Header, "chat_metadata")
		for _, d := range []ChatData{p.Header, p.Metadata} {
			for _, k := range []string{"vc_f2", "vc_binding", "vc_branch_root", "vc_f2_parent"} {
				delete(d, k)
			}
		}
		p.Result.UnresolvedExtensionReferences += countTransferReferences(p.Header, known) + countTransferReferences(p.Metadata, known)
		return nil

	}
	_, e = chatjsonl.Read(r, chatjsonl.Handlers{OnHeader: headerHandler, OnMessage: func(line int, raw chatjsonl.Object) error {
		encoded, e := json.Marshal(raw)
		if e != nil {
			return e
		}
		if len(pending) > 0 && (len(pending) >= 32 || pendingBytes+len(encoded) > 2<<20) {
			if e = flush(); e != nil {
				return e
			}
		}
		pending = append(pending, transferPendingMessage{line, raw})
		pendingBytes += len(encoded)
		return nil
	}})
	if e == nil {
		e = flush()
	}
	if e != nil {
		return p, e
	}
	p.Rows, e = writer.Seal()
	p.MetadataChanged = action != "save"
	p.OrderChanged = action != "save"
	if action == "save" {
		oldHeader := copyChatData(baseline.Header)
		for _, k := range []string{"vc_f2", "vc_binding", "vc_branch_root", "vc_f2_parent"} {
			delete(oldHeader, k)
		}
		p.MetadataChanged = !equalChatValue(oldHeader, p.Header) || !equalChatValue(baseline.Metadata, p.Metadata)
		p.OrderChanged = len(originalIDs) != len(p.IDs)
		if !p.OrderChanged {
			for i, id := range originalIDs {
				if id != p.IDs[i] {
					p.OrderChanged = true
					break
				}
			}
		}
	}
	return p, e
}

func transferFailureCode(p preparedTransfer) string {
	for _, i := range p.Result.Issues {
		if i.Code == chatjsonl.TooLargeCode {
			return i.Code
		}
	}
	return chatjsonl.InvalidCode
}
func (s *Store) commitPreparedTransfer(ctx context.Context, tx pgx.Tx, owner int64, in NativeChatUpload, action string, p preparedTransfer, objects chattransfer.Objects, op string, epoch int64) (NativeChatWriteResult, error) {
	out := NativeChatWriteResult{RequestID: in.RequestID, IdentityMapping: p.Mapping}
	var c StoredChat
	var parentRelationship *int64
	var e error
	if action == "save" {
		c, e = s.nativeTarget(ctx, tx, owner, in.Scope, in.FileName, epoch, true)
		if e != nil {
			return out, e
		}
		if c.ChatID != in.ChatID {
			return out, ErrNotFound
		}
		if c.Revision != in.ChatRevision {
			return out, chatError("REVISION_CONFLICT")
		}
		c.Revision++
		if p.MetadataChanged {
			c.MetadataRevision++
		}
		if p.OrderChanged {
			c.OrderRevision++
		}
	} else {
		var used bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.chat_file_alias WHERE owner_user_id=$1 AND chat_id=$2) OR EXISTS(SELECT 1 FROM vc.stored_chat WHERE owner_user_id=$1 AND chat_id=$2)`, owner, in.ChatID).Scan(&used)
		if e != nil {
			return out, e
		}
		if used {
			return out, chatError("CHAT_ID_REUSED")
		}
		c = StoredChat{StoredChatSummary: StoredChatSummary{ChatID: in.ChatID, Kind: in.Scope.Kind, CharacterRef: in.Scope.CharacterRef, GroupRef: in.Scope.GroupRef, BranchRoot: in.ChatID, Revision: 1, MetadataRevision: 1, OrderRevision: 1, AuthorityEpoch: epoch}, Header: p.Header, Metadata: p.Metadata}
		if action == "fork" {
			parent, e := s.readStoredChat(ctx, tx, owner, in.ParentChatID, epoch)
			if e != nil {
				return out, e
			}
			if parent.Revision != in.ParentRevision {
				return out, chatError("REVISION_CONFLICT")
			}
			if parent.Kind != in.Scope.Kind || nativeScopeRef(NativeChatScope{parent.Kind, parent.CharacterRef, parent.GroupRef}) != nativeScopeRef(in.Scope) {
				return out, ErrNotFound
			}
			c.BranchRoot = parent.BranchRoot
			parentRelationship = parent.RelationshipID
			if parent.ConversationID != nil {
				if e = tx.QueryRow(ctx, `SELECT st_mode FROM vc.conversation WHERE owner_user_id=$1 AND id=$2`, owner, *parent.ConversationID).Scan(&in.Mode); e != nil {
					return out, e
				}
			}
		}
		if in.Scope.Kind == "SINGLE" {
			var conversation, relationship int64
			e = tx.QueryRow(ctx, `SELECT out_conversation_id,out_relationship_id FROM vc.resolve_st_binding($1,$2,$3,$4,$5,'')`, owner, in.ChatID, *in.Scope.CharacterRef, in.Mode, parentRelationship).Scan(&conversation, &relationship)
			if e != nil {
				return out, e
			}
			c.ConversationID = &conversation
			c.RelationshipID = &relationship
			c.Header["vc_binding"] = ChatData{"chatIdentity": c.ChatID, "conversationId": strconv.FormatInt(conversation, 10), "relationshipId": strconv.FormatInt(relationship, 10), "characterRef": *in.Scope.CharacterRef, "mode": in.Mode}
		}
		c.Header["vc_f2"] = ChatData{"id": c.ChatID, "revision": 1}
		c.Header["vc_branch_root"] = c.BranchRoot
		h, e := s.encodeChatJSON(c.Header)
		if e != nil {
			return out, e
		}
		m, e := s.encodeChatJSON(c.Metadata)
		if e != nil {
			return out, e
		}
		c, e = s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.insert_stored_chat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, owner, c.ChatID, c.Kind, c.ConversationID, c.RelationshipID, c.CharacterRef, c.GroupRef, c.BranchRoot, c.Title, h, m), epoch)
		if e != nil {
			return out, e
		}
		if in.FileName != "" && in.FileName != c.ChatID+".jsonl" {
			if _, e = tx.Exec(ctx, `SELECT vc.rename_chat_file($1,$2,$3)`, owner, c.ChatID, in.FileName); e != nil {
				return out, e
			}
		}
	}
	if in.Generation != nil {
		if e = s.checkStoredChatGeneration(ctx, tx, owner, c.ChatID, *in.Generation); e != nil {
			return out, e
		}
	}
	if action == "save" {
		binding := c.Header["vc_binding"]
		c.Header = p.Header
		c.Metadata = p.Metadata
		if binding != nil {
			c.Header["vc_binding"] = binding
		}
	}
	canonicalHeader, e := chatJSON(storedChatExportHeader(c))
	if e != nil {
		return out, e
	}
	if len(canonicalHeader) > chatjsonl.MaxHeaderBytes {
		return out, chatError("CHAT_PAYLOAD_TOO_LARGE")
	}
	c.MessageCount = int64(len(p.IDs))
	nextPosition := c.MessageCount
	if action == "save" {
		nextPosition = p.NextPosition
		if p.OrderChanged {
			nextPosition += c.MessageCount
		}
	}
	if e = s.persistStoredChat(ctx, tx, owner, c, nextPosition, p.MetadataChanged, p.OrderChanged, false); e != nil {
		return out, e
	}

	var deleted []string
	if e = tx.QueryRow(ctx, `SELECT vc.delete_missing_transfer_messages($1,$2,$3,$4)`, owner, c.ChatID, c.Revision, p.IDs).Scan(&deleted); e != nil {
		return out, e
	}
	if len(deleted) > 0 || p.ClearReceipts {
		if _, e = tx.Exec(ctx, `SELECT vc.clear_stored_chat_receipt_bodies($1,$2)`, owner, c.ChatID); e != nil {
			return out, e
		}
	}
	r, e := chattransfer.NewReader(ctx, objects, p.Rows)
	if e != nil {
		return out, e
	}
	decoder := json.NewDecoder(r)
	decoder.UseNumber()

	positionIndex := int64(0)
	changedIDs := []string{}
	batch := []preparedTransferRow{}
	batchBytes := 0
	flushRows := func() error {
		if len(batch) == 0 {
			return nil
		}
		raw, e := chatJSON(batch)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `SELECT vc.apply_chat_transfer_rows($1,$2,$3,$4)`, owner, c.ChatID, c.Revision, raw); e != nil {
			return e
		}
		if c.ConversationID != nil && action != "fork" {
			changed := []string{}
			projection := []ChatData{}
			projected := []string{}
			for _, row := range batch {
				if row.SourceChanged {
					changed = append(changed, row.ID)
				}
				if row.ContentChanged || row.SourceChanged {
					projection = append(projection, row.Projection)
					projected = append(projected, row.ID)
				}
			}
			if len(changed) > 0 {
				if _, e = tx.Exec(ctx, `SELECT vc.revoke_stored_chat_sources($1,$2,$3,false)`, owner, c.ChatID, changed); e != nil {
					return e
				}
			}
			if len(projection) > 0 {
				if e = publishStoredSources(ctx, tx, owner, c.ChatID, projection, projected, false); e != nil {
					return e
				}
			}
		}
		batch = nil
		batchBytes = 0
		return nil
	}
	for {
		var row preparedTransferRow
		e = decoder.Decode(&row)
		if errors.Is(e, io.EOF) {
			break
		}
		if e != nil {
			return out, e
		}
		positionIndex++
		if action == "save" && p.OrderChanged {
			row.Position = p.NextPosition + positionIndex
		}
		row.Projection["position"] = strconv.FormatInt(row.Position, 10)
		if !row.ContentChanged && !row.SourceChanged && !p.OrderChanged {
			continue
		}
		size := len(row.Data)
		for _, candidate := range row.Candidates {
			size += len(candidate.Data)
		}
		if text, ok := row.Projection["text"].(string); ok {
			size += len(text)
		}
		if len(batch) > 0 && (len(batch) >= 32 || batchBytes+size > 2<<20) {
			if e = flushRows(); e != nil {
				return out, e
			}
		}
		batch = append(batch, row)
		batchBytes += size
		changedIDs = append(changedIDs, row.ID)
	}
	if e = flushRows(); e != nil {
		return out, e
	}

	if len(deleted) > 0 && c.ConversationID != nil {
		if _, e = tx.Exec(ctx, `SELECT vc.revoke_stored_chat_sources($1,$2,$3,false)`, owner, c.ChatID, deleted); e != nil {
			return out, e
		}
	}
	if e = publishStoredSources(ctx, tx, owner, c.ChatID, nil, deleted, p.OrderChanged); e != nil {
		return out, e
	}
	if in.Generation != nil {
		var ok bool
		if e = tx.QueryRow(ctx, `SELECT vc.finish_stored_chat_run($1,$2,$3,$4)`, owner, c.ChatID, in.Generation.RunID, in.Generation.State).Scan(&ok); e != nil {
			return out, e
		}
		if !ok {
			return out, chatError("CHAT_GENERATION_FENCED")
		}
	}
	if _, e = tx.Exec(ctx, `SELECT vc.fence_changed_stored_chat_runs($1,$2)`, owner, c.ChatID); e != nil {
		return out, e
	}
	if action == "fork" && c.ConversationID != nil {
		mapping := []ChatForkMapping{}
		for _, m := range p.Mapping {
			if m.InputMessageID == nil {
				continue
			}
			entry := ChatForkMapping{ParentMessageID: *m.InputMessageID, MessageID: m.MessageID, Candidates: []ChatForkCandidateMapping{}}
			for _, candidate := range m.Candidates {
				if candidate.InputCandidateID != nil {
					entry.Candidates = append(entry.Candidates, ChatForkCandidateMapping{ParentCandidateID: *candidate.InputCandidateID, CandidateID: candidate.CandidateID})
				}
			}
			mapping = append(mapping, entry)
		}
		raw, _ := chatJSON(mapping)
		if _, e = tx.Exec(ctx, `SELECT vc.copy_stored_chat_sources($1,$2,$3,$4)`, owner, in.ParentChatID, c.ChatID, raw); e != nil {
			return out, e
		}
	}
	if action == "fork" && c.ConversationID != nil {
		reader, e := chattransfer.NewReader(ctx, objects, p.Rows)
		if e != nil {
			return out, e
		}
		decoder := json.NewDecoder(reader)
		decoder.UseNumber()
		projection := []ChatData{}
		ids := []string{}
		bytes := 0
		flush := func() error {
			if len(ids) == 0 {
				return nil
			}
			e := publishStoredSources(ctx, tx, owner, c.ChatID, projection, ids, false)
			projection = nil
			ids = nil
			bytes = 0
			return e
		}
		for {
			var row preparedTransferRow
			e = decoder.Decode(&row)
			if errors.Is(e, io.EOF) {
				break
			}
			if e != nil {
				return out, e
			}
			text, _ := row.Projection["text"].(string)
			if len(ids) > 0 && (len(ids) >= 32 || bytes+len(text) > 2<<20) {
				if e = flush(); e != nil {
					return out, e
				}
			}
			projection = append(projection, row.Projection)
			ids = append(ids, row.ID)
			bytes += len(text)
		}
		if e = flush(); e != nil {
			return out, e
		}
	}

	event := ChatChange{OperationID: op, Revision: c.Revision, MetadataRevision: c.MetadataRevision, OrderRevision: c.OrderRevision, AuthorityEpoch: epoch, ChangedIDs: changedIDs, DeletedIDs: deleted, MetadataChanged: p.MetadataChanged, OrderChanged: p.OrderChanged}
	if e = storeChatChange(ctx, tx, owner, c.ChatID, event); e != nil {
		return out, e
	}
	if e = s.chatAliases(ctx, tx, owner, &c.StoredChatSummary); e != nil {
		return out, e
	}
	out.Chat = c.StoredChatSummary
	return out, nil
}
func (s *Store) WriteNativeChat(ctx context.Context, owner int64, action string, in NativeChatUpload, intentID string, manifest chattransfer.Manifest, fileSHA256 string, objects chattransfer.Objects) (NativeChatWriteResult, error) {
	var out NativeChatWriteResult
	in.RequestID = strings.ToLower(in.RequestID)
	in.ChatID = strings.ToLower(in.ChatID)
	in.ParentChatID = strings.ToLower(in.ParentChatID)
	if (action != "create" && action != "save" && action != "fork") || validateNativeScope(in.Scope) != nil || !validTransferHash(fileSHA256) {
		return out, ErrInvalid
	}
	if _, e := normalizeChatID(in.ChatID); e != nil {
		return out, e
	}
	if in.FileName == "" && action != "save" {
		in.FileName = in.ChatID + ".jsonl"
	}
	if !validNativeName(in.FileName) {
		return out, ErrInvalid
	}
	if action == "save" {
		if in.ChatRevision < 0 {
			return out, ErrInvalid
		}
	} else if in.ChatRevision != 0 || action == "create" && !validTransferMode(in.Scope, in.Mode) {
		return out, ErrInvalid
	}
	if in.ChatRevision >= 9007199254740991 {
		return out, chatError("CHAT_INVALID_OPERATION")
	}
	if manifest.Prefix != "chat-transfer/"+intentID+"/" || manifest.Bytes < 0 || manifest.Bytes > chatjsonl.MaxFileBytes {
		return out, ErrInvalid
	}
	if e := s.BindChatTransfer(ctx, owner, intentID); e != nil {
		return out, e
	}
	// Receipt lookup precedes preparation: committed retries never reroll identities.
	payload := struct {
		Input  NativeChatUpload
		SHA256 string
	}{in, fileSHA256}
	resource := "POST /api/v1/service/chats/native/" + action
	var p preparedTransfer
	prepared := false
	// The receipt transaction itself is also the final publication transaction.
	// Preparation is explicitly completed first, then a second receipt lookup/CAS
	// prevents a concurrent commit or an unrelated tail append from being lost.
	replay, e := s.lookupTransferReceipt(ctx, owner, resource, in.RequestID, in.AuthorityEpoch, payload)
	if e != nil {
		return out, e
	}
	if replay != nil {
		e = chatDecode(replay.Body, &out)
		return out, e
	}
	p, e = s.prepareTransfer(ctx, owner, action, in, manifest, objects)
	if e != nil {
		return out, e
	}
	prepared = true
	if prepared && p.Intent.ID != "" {
		defer s.ReleaseChatTransfer(ctx, owner, p.Intent.ID)
	}
	if len(p.Result.Issues) > 0 {
		return out, chatError(transferFailureCode(p))
	}
	result, e := s.storedChatWriteBoundary(ctx, owner, resource, in.RequestID, in.AuthorityEpoch, payload, true, func(ctx context.Context, tx pgx.Tx, op string, epoch int64) (chatWriteResult, error) {
		if action != "save" {
			var reserved bool
			if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.chat_import WHERE owner_user_id=$1 AND chat_id=$2)`, owner, in.ChatID).Scan(&reserved); e != nil {
				return chatWriteResult{}, e
			}
			if reserved {
				return chatWriteResult{}, chatError("CHAT_ID_REUSED")
			}
		}
		out, e := s.commitPreparedTransfer(ctx, tx, owner, in, action, p, objects, op, epoch)
		if e != nil {
			return chatWriteResult{}, e
		}
		body, e := chatJSON(out)
		status := 200
		if action == "create" || action == "fork" {
			status = 201
		}
		return chatWriteResult{ChatID: in.ChatID, Revision: out.Chat.Revision, Status: status, Body: body}, e
	})
	if e == nil {
		e = chatDecode(result.Body, &out)
	}
	return out, e
}
func (s *Store) lookupTransferReceipt(ctx context.Context, owner int64, resource, requestID string, epoch int64, payload any) (*chatWriteResult, error) {
	var out *chatWriteResult
	digest, e := chatDigest(payload)
	if e != nil {
		return nil, e
	}
	e = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		mode, current, e := lockChatAuthority(ctx, tx, owner, false)
		if e != nil {
			return e
		}
		if mode != "GO" || current != epoch {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		var d []byte
		var body *string
		var expired bool
		var r chatWriteResult
		e = tx.QueryRow(ctx, `SELECT request_digest,chat_id::text,result_revision,status,result_cipher,expires_at<=now() FROM vc.chat_receipt WHERE owner_user_id=$1 AND resource=$2 AND request_id=$3`, owner, resource, requestID).Scan(&d, &r.ChatID, &r.Revision, &r.Status, &body, &expired)
		if errors.Is(e, pgx.ErrNoRows) {
			return nil
		}
		if e != nil {
			return e
		}
		if fmt.Sprintf("%x", d) != fmt.Sprintf("%x", digest) {
			return chatError("IDEMPOTENCY_KEY_REUSED")
		}
		if body == nil || expired {
			return chatError("OPERATION_RESULT_EXPIRED")
		}
		if _, e = s.readStoredChat(ctx, tx, owner, r.ChatID, current); e != nil {
			return e
		}
		plain, e := s.decryptStored(*body)
		if e != nil {
			return e
		}
		r.Body = []byte(plain)
		out = &r
		return nil
	})
	return out, e
}
