package postgres

import (
	"bytes"
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *Store) ApplyStoredChatOperations(ctx context.Context, owner int64, chatID string, in ChatOperationsRequest) (ChatCommit, error) {
	if len(in.Operations) < 1 || len(in.Operations) > 100 {
		return ChatCommit{}, chatError("CHAT_INVALID_OPERATION")
	}
	commands := make([]chatCommand, 0, len(in.Operations))
	for _, op := range in.Operations {
		command, err := decodeChatCommand(op)
		if err != nil {
			return ChatCommit{}, err
		}
		commands = append(commands, command)
	}
	return s.mutateStoredChat(ctx, owner, chatID, storedChatResource("POST", chatID, "/operations"), in.RequestID, in.AuthorityEpoch, in, commands, in.Generation, 200)
}
func (s *Store) AppendStoredMessages(ctx context.Context, owner int64, chatID string, in ChatAppendRequest) (ChatCommit, error) {
	commands := []chatCommand{{kind: "append", messages: in.Messages}}
	return s.mutateStoredChat(ctx, owner, chatID, storedChatResource("POST", chatID, "/messages"), in.RequestID, in.AuthorityEpoch, in, commands, in.Generation, 201)
}
func (s *Store) EditStoredMessage(ctx context.Context, owner int64, chatID, messageID string, in ChatMessageEditRequest) (ChatCommit, error) {
	command := chatCommand{kind: "edit", messageID: strings.ToLower(messageID), baseRevision: in.BaseRevision, changes: in.Changes}
	if in.CandidateID != nil {
		command.candidateID = strings.ToLower(*in.CandidateID)
		if command.candidateID == "" {
			return ChatCommit{}, ErrInvalid
		}
	}
	return s.mutateStoredChat(ctx, owner, chatID, storedChatResource("PATCH", chatID, "/messages/"+command.messageID), in.RequestID, in.AuthorityEpoch, in, []chatCommand{command}, in.Generation, 200)
}
func (s *Store) EditStoredChatMetadata(ctx context.Context, owner int64, chatID string, in ChatMetadataEditRequest) (ChatCommit, error) {
	command := chatCommand{kind: "metadata", baseRevision: in.BaseRevision, changes: in.Changes}
	return s.mutateStoredChat(ctx, owner, chatID, storedChatResource("PATCH", chatID, "/metadata"), in.RequestID, in.AuthorityEpoch, in, []chatCommand{command}, nil, 200)
}

func (s *Store) mutateStoredChat(ctx context.Context, owner int64, chatID, resource, requestID string, epoch int64, payload any, commands []chatCommand, generation *ChatGenerationCommit, successStatus int) (ChatCommit, error) {
	var out ChatCommit
	id, err := normalizeChatID(chatID)
	if err != nil {
		return out, err
	}
	appends := 0
	for i := range commands {
		if commands[i].kind == "insert" && generation != nil {
			return out, chatError("CHAT_INVALID_OPERATION")
		}
		if err := normalizeCommandIDs(&commands[i]); err != nil {
			return out, err
		}
		appends += len(commands[i].messages)
	}
	if appends > 100 {
		return out, chatError("CHAT_INVALID_OPERATION")
	}
	wire, err := chatJSON(payload)
	if err != nil {
		return out, ErrInvalid
	}
	if len(wire) > StoredChatMutationBytes {
		return out, chatError("CHAT_PAYLOAD_TOO_LARGE")
	}
	requestID = strings.ToLower(requestID)
	generation = normalizeChatGeneration(generation)
	result, err := s.storedChatWrite(ctx, owner, resource, requestID, epoch, payload, func(ctx context.Context, tx pgx.Tx, operationID string, currentEpoch int64) (chatWriteResult, error) {
		chat, err := s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.lock_stored_chat($1,$2,true)`, owner, id), currentEpoch)
		if err != nil {
			return chatWriteResult{}, err
		}
		if generation != nil {
			if err := s.checkStoredChatGeneration(ctx, tx, owner, id, *generation); err != nil {
				return chatWriteResult{}, err
			}
		}
		mutation := &storedChatMutation{store: s, owner: owner, chat: chat, start: map[string]StoredMessage{}, messages: map[string]StoredMessage{},
			deleted: map[string]bool{}, appended: map[string][]byte{}, addedCandidates: map[string]map[string][]byte{},
			positions: map[string]int64{}, returned: map[string]bool{}, generation: generation}
		if err = tx.QueryRow(ctx, `SELECT next_position FROM vc.stored_chat WHERE owner_user_id=$1 AND chat_id=$2`, owner, id).Scan(&mutation.nextPosition); err != nil {
			return chatWriteResult{}, err
		}
		mutation.metadata, err = cloneChatData(ChatData{"title": chat.Title, "header": chat.Header, "metadata": chat.Metadata})
		if err != nil {
			return chatWriteResult{}, err
		}
		if err = mutation.prepare(ctx, tx, commands); err != nil {
			return chatWriteResult{}, err
		}
		if err = mutation.apply(ctx, tx, commands); err != nil {
			return chatWriteResult{}, err
		}
		commit, err := mutation.persist(ctx, tx, requestID, operationID)
		if err != nil {
			return chatWriteResult{}, err
		}
		body, err := chatJSON(commit)
		return chatWriteResult{ChatID: id, Revision: commit.Revision, Status: successStatus, Body: body}, err
	})
	if err != nil {
		return out, err
	}
	err = chatDecode(result.Body, &out)
	out.HTTPStatus = result.Status
	return out, err
}

type storedChatMutation struct {
	store           *Store
	owner           int64
	chat            StoredChat
	metadata        ChatData
	start, messages map[string]StoredMessage
	deleted         map[string]bool
	appended        map[string][]byte
	addedCandidates map[string]map[string][]byte
	positions       map[string]int64
	returned        map[string]bool
	nextPosition    int64
	orderChanged    bool
	rebased         bool
	generation      *ChatGenerationCommit
}

func (m *storedChatMutation) load(ctx context.Context, tx pgx.Tx, id string) error {
	if _, ok := m.start[id]; ok {
		return nil
	}
	row, err := m.store.loadStoredMessage(ctx, tx, m.owner, m.chat.ChatID, id)
	if err != nil {
		return err
	}
	row.Data["vc_message_id"] = row.MessageID
	for i := range row.Candidates {
		decorateStoredCandidate(&row.Candidates[i])
	}
	m.start[id] = row
	copy := row
	copy.Data, err = cloneChatData(row.Data)
	if err != nil {
		return err
	}
	copy.Candidates = append([]StoredCandidate(nil), row.Candidates...)
	for i := range copy.Candidates {
		copy.Candidates[i].Data, err = cloneChatData(row.Candidates[i].Data)
		if err != nil {
			return err
		}
	}
	m.messages[id] = copy
	return nil
}

func (m *storedChatMutation) prepare(ctx context.Context, tx pgx.Tx, commands []chatCommand) error {
	paths := map[string][]ChatFieldChange{}
	messageOperations := map[string]int{}
	deletes := map[string]bool{}
	removals := map[string]bool{}
	for _, command := range commands {
		if command.messageID != "" {
			messageOperations[command.messageID]++
			if err := m.load(ctx, tx, command.messageID); err != nil {
				return err
			}
		}
		if command.kind == "delete" {
			deletes[command.messageID] = true
		}
		if command.kind == "removeSwipe" {
			key := command.messageID + "/" + command.candidateID
			if removals[key] {
				return chatError("CHAT_INVALID_OPERATION")
			}
			removals[key] = true
		}
	}
	for id := range deletes {
		if messageOperations[id] != 1 {
			return chatError("CHAT_INVALID_OPERATION")
		}
	}
	for _, c := range commands {
		start := m.start[c.messageID]
		switch c.kind {
		case "append", "insert":
			if c.kind == "insert" {
				var present bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3 AND deleted_at IS NULL)`, m.owner, m.chat.ChatID, c.firstID).Scan(&present); err != nil {
					return err
				}
				if !present {
					return ErrNotFound
				}
				if deletes[c.firstID] {
					return chatError("CHAT_INVALID_OPERATION")
				}
				if c.orderRevision != m.chat.OrderRevision {
					return chatError("REVISION_CONFLICT")
				}
			}
			for _, entry := range c.messages {
				if deletes[entry.MessageID] {
					return chatError("CHAT_INVALID_OPERATION")
				}
			}
		case "edit", "metadata":
			if err := validateChatChangePaths(c.changes, c.kind == "metadata", c.candidateID != ""); err != nil {
				return err
			}
			data, version, key := start.Data, start.Revision, c.messageID+"/"+c.candidateID
			if c.kind == "metadata" {
				data = ChatData{"title": m.chat.Title, "header": m.chat.Header, "metadata": m.chat.Metadata}
				version, key = m.chat.MetadataRevision, "metadata"
			} else if c.candidateID != "" {
				at := candidateIndex(start, c.candidateID)
				if at < 0 {
					return chatError("REVISION_CONFLICT")
				}
				if removals[key] {
					return chatError("CHAT_INVALID_OPERATION")
				}
				data = start.Candidates[at].Data
			}
			if c.baseRevision < 0 || c.baseRevision > version {
				return chatError("REVISION_CONFLICT")
			}
			if err := checkChatFieldChanges(data, c.changes); err != nil {
				return err
			}
			all := append(append([]ChatFieldChange(nil), paths[key]...), c.changes...)
			if err := validateChatChangePaths(all, c.kind == "metadata", c.candidateID != ""); err != nil {
				return err
			}
			paths[key] = all
			m.rebased = m.rebased || c.baseRevision < version
		case "delete", "addSwipe", "selectSwipe", "removeSwipe":
			if c.messageRevision != start.Revision {
				return chatError("REVISION_CONFLICT")
			}
			if c.kind == "addSwipe" && removals[c.messageID+"/"+c.candidate.CandidateID] {
				return chatError("CHAT_INVALID_OPERATION")
			}
			if c.kind == "selectSwipe" || c.kind == "removeSwipe" {
				if c.selectedID != start.SelectedCandidateID {
					return chatError("REVISION_CONFLICT")
				}
				if c.kind == "removeSwipe" && candidateIndex(start, c.candidateID) < 0 {
					return chatError("REVISION_CONFLICT")
				}
				if c.kind == "selectSwipe" && removals[c.messageID+"/"+c.candidateID] {
					return chatError("CHAT_INVALID_OPERATION")
				}
			}
		case "reorder":
			if c.orderRevision != m.chat.OrderRevision {
				return chatError("REVISION_CONFLICT")
			}
			if err := m.prepareReorder(ctx, tx, c, deletes); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *storedChatMutation) prepareReorder(ctx context.Context, tx pgx.Tx, command chatCommand, deletes map[string]bool) error {
	var first, last int64
	err := tx.QueryRow(ctx, `SELECT a.position,b.position FROM vc.stored_message a JOIN vc.stored_message b
 ON(a.owner_user_id,a.chat_id)=(b.owner_user_id,b.chat_id)
 WHERE a.owner_user_id=$1 AND a.chat_id=$2 AND a.message_id=$3 AND b.message_id=$4 AND a.deleted_at IS NULL AND b.deleted_at IS NULL`, m.owner, m.chat.ChatID, command.firstID, command.lastID).Scan(&first, &last)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if first > last {
		return chatError("CHAT_INVALID_OPERATION")
	}
	rows, err := tx.Query(ctx, `SELECT message_id::text,position FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2
 AND deleted_at IS NULL AND position BETWEEN $3 AND $4 ORDER BY position`, m.owner, m.chat.ChatID, first, last)
	if err != nil {
		return err
	}
	var positions []int64
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		var position int64
		if err = rows.Scan(&id, &position); err != nil {
			rows.Close()
			return err
		}
		if deletes[id] {
			rows.Close()
			return chatError("CHAT_INVALID_OPERATION")
		}
		if _, overlap := m.positions[id]; overlap {
			rows.Close()
			return chatError("CHAT_INVALID_OPERATION")
		}
		ids[id] = true
		positions = append(positions, position)
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}
	if len(command.messageIDs) != len(positions) {
		return chatError("CHAT_INVALID_OPERATION")
	}
	for i, id := range command.messageIDs {
		if !ids[id] {
			return chatError("CHAT_INVALID_OPERATION")
		}
		delete(ids, id)
		m.positions[id] = positions[i]
	}
	m.orderChanged = true
	return nil
}

func (m *storedChatMutation) apply(ctx context.Context, tx pgx.Tx, commands []chatCommand) error {
	generatedOutput := false
	for _, c := range commands {
		row := m.messages[c.messageID]
		switch c.kind {
		case "insert":
			if err := m.insert(ctx, tx, c); err != nil {
				return err
			}
		case "reorder":
			rows, err := tx.Query(ctx, `SELECT position FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=ANY($3::uuid[]) ORDER BY position`, m.owner, m.chat.ChatID, c.messageIDs)
			if err != nil {
				return err
			}
			var positions []int64
			for rows.Next() {
				var p int64
				if err = rows.Scan(&p); err != nil {
					rows.Close()
					return err
				}
				positions = append(positions, p)
			}
			rows.Close()
			if rows.Err() != nil {
				return rows.Err()
			}
			for i, id := range c.messageIDs {
				m.positions[id] = positions[i]
				if row, ok := m.messages[id]; ok {
					row.Position = strconv.FormatInt(positions[i], 10)
					m.messages[id] = row
				}
				if _, err = tx.Exec(ctx, `SELECT vc.reorder_stored_message($1,$2,$3,$4)`, m.owner, m.chat.ChatID, id, positions[i]); err != nil {
					return err
				}
			}
		case "append":
			for _, entry := range c.messages {
				if err := m.append(ctx, tx, entry); err != nil {
					return err
				}
			}
			generatedOutput = true
		case "edit":
			if c.candidateID == "" {
				applyChatFieldChanges(row.Data, c.changes)
			} else {
				at := candidateIndex(row, c.candidateID)
				applyChatFieldChanges(row.Candidates[at].Data, c.changes)
				if m.generation != nil {
					row.Candidates[at].settled = m.generation.State == "settled"
				}
				generatedOutput = true
			}
			m.messages[c.messageID], m.returned[c.messageID] = row, true
		case "metadata":
			applyChatFieldChanges(m.metadata, c.changes)
		case "delete":
			m.deleted[c.messageID] = true
		case "addSwipe":
			if err := m.addCandidate(ctx, tx, &row, *c.candidate); err != nil {
				return err
			}
			m.messages[c.messageID], m.returned[c.messageID] = row, true
			generatedOutput = true
		case "selectSwipe":
			if candidateIndex(row, c.candidateID) < 0 {
				return chatError("REVISION_CONFLICT")
			}
			row.SelectedCandidateID = c.candidateID
			m.messages[c.messageID], m.returned[c.messageID] = row, true
		case "removeSwipe":
			at := candidateIndex(row, c.candidateID)
			if at < 0 || len(row.Candidates) == 1 {
				return chatError("CHAT_INVALID_OPERATION")
			}
			if row.SelectedCandidateID == c.candidateID {
				if c.replacement == nil || *c.replacement == c.candidateID || candidateIndex(row, *c.replacement) < 0 {
					return chatError("CHAT_INVALID_OPERATION")
				}
				row.SelectedCandidateID = *c.replacement
			} else if c.replacement != nil {
				return chatError("CHAT_INVALID_OPERATION")
			}
			row.Candidates = append(row.Candidates[:at], row.Candidates[at+1:]...)
			m.messages[c.messageID], m.returned[c.messageID] = row, true
		}
	}
	if m.generation != nil && !generatedOutput {
		return chatError("CHAT_INVALID_OPERATION")
	}
	return nil
}

func (m *storedChatMutation) insert(ctx context.Context, tx pgx.Tx, command chatCommand) error {
	var anchor int64
	if err := tx.QueryRow(ctx, `SELECT position FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3 AND deleted_at IS NULL`, m.owner, m.chat.ChatID, command.firstID).Scan(&anchor); err != nil {
		return err
	}
	var inserted []string
	newIDs := map[string]bool{}
	for _, entry := range command.messages {
		before := m.nextPosition
		if err := m.append(ctx, tx, entry); err != nil {
			return err
		}
		if m.nextPosition > before {
			inserted = append(inserted, entry.MessageID)
			newIDs[entry.MessageID] = true
		}
	}
	if len(inserted) == 0 {
		return nil
	}
	delta := int64(len(inserted))
	if _, err := tx.Exec(ctx, `SELECT vc.shift_stored_chat_positions($1,$2,$3,$4)`, m.owner, m.chat.ChatID, anchor, delta); err != nil {
		return err
	}
	for id, row := range m.messages {
		if !newIDs[id] && chatPosition(row) >= anchor {
			row.Position = strconv.FormatInt(chatPosition(row)+delta, 10)
			m.messages[id] = row
		}
	}
	for id, position := range m.positions {
		if position >= anchor {
			m.positions[id] = position + delta
		}
	}
	for i, id := range inserted {
		row := m.messages[id]
		row.Position = strconv.FormatInt(anchor+int64(i), 10)
		m.messages[id] = row
	}
	m.orderChanged = true
	return nil
}

func (m *storedChatMutation) append(ctx context.Context, tx pgx.Tx, entry ChatAppendMessage) error {
	digest, err := chatDigest(entry.Data)
	if err != nil {
		return err
	}
	if initial, exists := m.appended[entry.MessageID]; exists {
		if !bytes.Equal(initial, digest) {
			return chatError("CHAT_ID_REUSED")
		}
		return nil
	}
	var initial []byte
	var deleted bool
	err = tx.QueryRow(ctx, `SELECT initial_digest,deleted_at IS NOT NULL FROM vc.stored_message
 WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3`, m.owner, m.chat.ChatID, entry.MessageID).Scan(&initial, &deleted)
	if err == nil {
		if deleted || !bytes.Equal(initial, digest) {
			return chatError("CHAT_ID_REUSED")
		}
		if err := m.load(ctx, tx, entry.MessageID); err != nil {
			return err
		}
		m.returned[entry.MessageID] = true
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	m.nextPosition++
	settled := m.generation == nil || m.generation.State == "settled"
	row, err := splitNewStoredMessage(entry, m.nextPosition, settled)
	if err != nil {
		return err
	}
	m.messages[row.MessageID], m.appended[row.MessageID], m.returned[row.MessageID] = row, digest, true
	return nil
}

func (m *storedChatMutation) addCandidate(ctx context.Context, tx pgx.Tx, row *StoredMessage, input StoredCandidate) error {
	digest, err := chatDigest(input.Data)
	if err != nil {
		return err
	}
	if m.addedCandidates[row.MessageID] == nil {
		m.addedCandidates[row.MessageID] = map[string][]byte{}
	}
	if prior, exists := m.addedCandidates[row.MessageID][input.CandidateID]; exists {
		if !bytes.Equal(prior, digest) {
			return chatError("CHAT_ID_REUSED")
		}
		return nil
	}
	var initial []byte
	var deleted bool
	err = tx.QueryRow(ctx, `SELECT initial_digest,deleted_at IS NOT NULL FROM vc.stored_candidate
 WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3 AND candidate_id=$4`, m.owner, m.chat.ChatID, row.MessageID, input.CandidateID).Scan(&initial, &deleted)
	if err == nil {
		if deleted || !bytes.Equal(initial, digest) {
			return chatError("CHAT_ID_REUSED")
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	settled := m.generation == nil || m.generation.State == "settled"
	candidate, err := newStoredCandidate(input.CandidateID, input.Data, settled)
	if err != nil {
		return err
	}
	row.Candidates = append(row.Candidates, candidate)
	m.addedCandidates[row.MessageID][candidate.CandidateID] = digest
	return nil
}

func (m *storedChatMutation) persist(ctx context.Context, tx pgx.Tx, requestID, operationID string) (ChatCommit, error) {
	chat := m.chat
	chat.Revision++
	metadataChanged := !equalChatValue(m.metadata, ChatData{"title": chat.Title, "header": chat.Header, "metadata": chat.Metadata})
	if metadataChanged {
		var ok bool
		chat.Title, ok = m.metadata["title"].(string)
		if !ok || asChatData(m.metadata["header"]) == nil || asChatData(m.metadata["metadata"]) == nil {
			return ChatCommit{}, chatError("CHAT_INVALID_OPERATION")
		}
		chat.Header, chat.Metadata = asChatData(m.metadata["header"]), asChatData(m.metadata["metadata"])
		chat.MetadataRevision++
	}
	if m.orderChanged {
		chat.OrderRevision++
	}
	commit := ChatCommit{RequestID: requestID, OperationID: operationID, ChatID: chat.ChatID, Rebased: m.rebased,
		Revision: chat.Revision, MetadataRevision: chat.MetadataRevision, OrderRevision: chat.OrderRevision,
		AuthorityEpoch: chat.AuthorityEpoch, Changed: []StoredMessage{}, DeletedIDs: []string{}}
	changedIDs, sourceChanges := []string{}, []string{}
	projectionRows, projectionIDs := []ChatData{}, []string{}
	clearReceipts := false
	for id, row := range m.messages {
		before, existed := m.start[id]
		if m.deleted[id] {
			row.Revision++
			if err := m.store.persistStoredMessage(ctx, tx, m.owner, chat, row, before, false, true, true, true, nil, nil); err != nil {
				return commit, err
			}
			chat.MessageCount--
			commit.DeletedIDs = append(commit.DeletedIDs, id)
			sourceChanges = append(sourceChanges, id)
			projectionIDs = append(projectionIDs, id)
			clearReceipts = true
			continue
		}
		contentChanged := !existed || !sameStoredMessageContent(before, row)
		sourceChanged := !existed || before.SelectedCandidateID != row.SelectedCandidateID
		if existed {
			oldSelected, newSelected := candidateIndex(before, before.SelectedCandidateID), candidateIndex(row, row.SelectedCandidateID)
			if oldSelected < 0 || newSelected < 0 {
				return commit, chatError("CHAT_INVALID_OPERATION")
			}
			sourceChanged = sourceChanged || !equalChatValue(sourceCandidateData(before.Data, before.Candidates[oldSelected]), sourceCandidateData(row.Data, row.Candidates[newSelected]))
			for i := range row.Candidates {
				c := &row.Candidates[i]
				old := candidateIndex(before, c.CandidateID)
				if old >= 0 {
					prior := before.Candidates[old]
					if !equalChatValue(sourceCandidateData(before.Data, prior), sourceCandidateData(row.Data, *c)) {
						c.SourceRevision = prior.SourceRevision + 1
					}
					wasSelected, selected := before.SelectedCandidateID == c.CandidateID, row.SelectedCandidateID == c.CandidateID
					if (wasSelected && !selected) || (selected && ((wasSelected && c.SourceRevision != prior.SourceRevision) || (!wasSelected && prior.everSelected))) {
						c.SourceGeneration = prior.SourceGeneration + 1
					}
				}
				c.everSelected = c.everSelected || c.CandidateID == row.SelectedCandidateID
				decorateStoredCandidate(c)
			}
			for _, previous := range before.Candidates {
				if candidateIndex(row, previous.CandidateID) < 0 {
					clearReceipts = true
					break
				}
			}
		}
		if contentChanged && existed {
			row.Revision = before.Revision + 1
		}
		row.CandidateCount = len(row.Candidates)
		if position, reordered := m.positions[id]; reordered {
			row.Position = strconv.FormatInt(position, 10)
			delete(m.positions, id)
		}
		positionChanged := existed && before.Position != row.Position
		if err := validateStoredMessageDocument(row); err != nil {
			return commit, err
		}
		if contentChanged || positionChanged {
			if err := m.store.persistStoredMessage(ctx, tx, m.owner, chat, row, before, !existed, contentChanged, sourceChanged, false, m.appended[id], m.addedCandidates[id]); err != nil {
				return commit, err
			}
			changedIDs = append(changedIDs, id)
		}
		if !existed {
			chat.MessageCount++
		}
		if sourceChanged {
			sourceChanges = append(sourceChanges, id)
		}
		// Settling a candidate affects source availability without changing its
		// signature or generation. Publish it even when sourceChanged is false.
		if contentChanged {
			projectionRows = append(projectionRows, storedSourceProjection(row))
			projectionIDs = append(projectionIDs, id)
		}
		if m.returned[id] || positionChanged {
			full, err := projectStoredMessage(row, "full")
			if err != nil {
				return commit, err
			}
			commit.Changed = append(commit.Changed, full)
		}
	}
	// A reorder changes only indexed positions; do not decrypt untouched history.
	for id := range m.positions {
		changedIDs = append(changedIDs, id)
	}
	if clearReceipts {
		if _, err := tx.Exec(ctx, `SELECT vc.clear_stored_chat_receipt_bodies($1,$2)`, m.owner, chat.ChatID); err != nil {
			return commit, err
		}
	}
	if err := m.store.persistStoredChat(ctx, tx, m.owner, chat, m.nextPosition, metadataChanged, m.orderChanged, false); err != nil {
		return commit, err
	}
	if _, err := tx.Exec(ctx, `SELECT vc.revoke_stored_chat_sources($1,$2,$3,false)`, m.owner, chat.ChatID, sourceChanges); err != nil {
		return commit, err
	}
	if err := publishStoredSources(ctx, tx, m.owner, chat.ChatID, projectionRows, projectionIDs, m.orderChanged); err != nil {
		return commit, err
	}
	if m.generation != nil {
		var finished bool
		if err := tx.QueryRow(ctx, `SELECT vc.finish_stored_chat_run($1,$2,$3,$4)`, m.owner, chat.ChatID, m.generation.RunID, m.generation.State).Scan(&finished); err != nil {
			return commit, err
		}
		if !finished {
			return commit, chatError("CHAT_GENERATION_FENCED")
		}
	}
	if _, err := tx.Exec(ctx, `SELECT vc.fence_changed_stored_chat_runs($1,$2)`, m.owner, chat.ChatID); err != nil {
		return commit, err
	}
	sort.Strings(changedIDs)
	sort.Strings(commit.DeletedIDs)
	sort.Slice(commit.Changed, func(i, j int) bool { return chatPosition(commit.Changed[i]) < chatPosition(commit.Changed[j]) })
	event := ChatChange{OperationID: operationID, Revision: chat.Revision, MetadataRevision: chat.MetadataRevision, OrderRevision: chat.OrderRevision,
		AuthorityEpoch: chat.AuthorityEpoch, ChangedIDs: changedIDs, DeletedIDs: commit.DeletedIDs, MetadataChanged: metadataChanged, OrderChanged: m.orderChanged}
	if err := storeChatChange(ctx, tx, m.owner, chat.ChatID, event); err != nil {
		return commit, err
	}
	if metadataChanged {
		commit.Chat = &chat
	}
	return commit, nil
}

func sameStoredMessageContent(a, b StoredMessage) bool {
	if a.SelectedCandidateID != b.SelectedCandidateID || len(a.Candidates) != len(b.Candidates) || !equalChatValue(a.Data, b.Data) {
		return false
	}
	for i := range a.Candidates {
		if a.Candidates[i].CandidateID != b.Candidates[i].CandidateID || a.Candidates[i].settled != b.Candidates[i].settled || !equalChatValue(a.Candidates[i].Data, b.Candidates[i].Data) {
			return false
		}
	}
	return true
}

func (s *Store) persistStoredMessage(ctx context.Context, tx pgx.Tx, owner int64, chat StoredChat, m, before StoredMessage, created, contentChanged, sourceChanged, deleted bool, initial []byte, candidateDigests map[string][]byte) error {
	if created {
		if err := s.insertStoredMessage(ctx, tx, owner, chat.ChatID, m, initial); err != nil {
			return err
		}
	}
	data := ""
	var err error
	if !deleted {
		data, err = s.encodeChatJSON(m.Data)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `SELECT vc.update_stored_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, owner, chat.ChatID, m.MessageID,
		chatPosition(m), m.Revision, m.SelectedCandidateID, data, chat.Revision, created, contentChanged, sourceChanged, deleted)
	if err != nil || deleted {
		return err
	}
	for i, c := range m.Candidates {
		data, err := s.encodeChatJSON(c.Data)
		if err != nil {
			return err
		}
		if !created && candidateIndex(before, c.CandidateID) < 0 {
			_, err = tx.Exec(ctx, `SELECT vc.insert_stored_candidate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, owner, chat.ChatID, m.MessageID,
				c.CandidateID, i, c.SourceRevision, c.SourceGeneration, c.settled, data, candidateDigests[c.CandidateID])
			if err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `SELECT vc.update_stored_candidate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`, owner, chat.ChatID, m.MessageID,
			c.CandidateID, i, c.SourceRevision, c.SourceGeneration, c.settled, c.everSelected, data)
		if err != nil {
			return err
		}
	}
	for i, c := range before.Candidates {
		if candidateIndex(m, c.CandidateID) < 0 {
			_, err = tx.Exec(ctx, `SELECT vc.update_stored_candidate($1,$2,$3,$4,$5,$6,$7,false,$8,'',true)`, owner, chat.ChatID, m.MessageID,
				c.CandidateID, i, c.SourceRevision, c.SourceGeneration+1, c.everSelected)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) persistStoredChat(ctx context.Context, tx pgx.Tx, owner int64, chat StoredChat, nextPosition int64, metadataChanged, orderChanged, deleted bool) error {
	chat.Header["vc_f2"] = ChatData{"id": chat.ChatID, "revision": chat.Revision}
	chat.Header["vc_branch_root"] = chat.BranchRoot
	header, err := s.encodeChatJSON(chat.Header)
	if err != nil {
		return err
	}
	metadata, err := s.encodeChatJSON(chat.Metadata)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT vc.update_stored_chat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, owner, chat.ChatID, chat.Title,
		header, metadata, chat.Revision, chat.MetadataRevision, chat.OrderRevision, nextPosition, chat.MessageCount, metadataChanged, orderChanged, deleted)
	return err
}
