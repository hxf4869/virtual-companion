package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strconv"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/jackc/pgx/v5"
)

func (s *Store) FreezeChatMigration(ctx context.Context, owner int64, runID, direction, expectedMode string, expectedEpoch int64) (ChatMigrationRun, error) {
	var out ChatMigrationRun
	if _, e := normalizeChatID(runID); e != nil {
		return out, e
	}
	e := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT run_id::text,direction,frozen_epoch,status FROM vc.freeze_chat_migration($1,$2,$3,$4,$5)`, owner, runID, direction, expectedMode, expectedEpoch).Scan(&out.RunID, &out.Direction, &out.FrozenEpoch, &out.Status)
	})
	return out, e
}
func (s *Store) migrationRun(ctx context.Context, tx pgx.Tx, owner int64, runID string) (ChatMigrationRun, error) {
	var r ChatMigrationRun
	e := tx.QueryRow(ctx, `SELECT run_id::text,direction,frozen_epoch,status FROM vc.chat_migration_run WHERE owner_user_id=$1 AND run_id=$2`, owner, runID).Scan(&r.RunID, &r.Direction, &r.FrozenEpoch, &r.Status)
	if e != nil {
		return r, e
	}
	mode, epoch, e := lockChatAuthority(ctx, tx, owner, false)
	if e != nil {
		return r, e
	}
	if mode != "FROZEN" || epoch != r.FrozenEpoch {
		return r, chatError("CHAT_AUTHORITY_CHANGED")
	}
	return r, nil
}
func (s *Store) ActivateChatMigration(ctx context.Context, owner int64, runID string, frozenEpoch int64) (int64, error) {
	var epoch int64
	e := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.activate_chat_migration($1,$2,$3)`, owner, runID, frozenEpoch).Scan(&epoch)
	})
	return epoch, e
}
func (s *Store) ChatMigrationSupplement(ctx context.Context, owner int64, runID string) (ChatMigrationManifest, error) {
	var out ChatMigrationManifest
	e := s.withChatTransfer(ctx, owner, pgx.TxOptions{IsoLevel: pgx.RepeatableRead}, func(ctx context.Context, tx pgx.Tx) error {
		run, e := s.migrationRun(ctx, tx, owner, runID)
		if e != nil {
			return e
		}
		out = ChatMigrationManifest{FormatVersion: 1, MigrationRunID: runID, Direction: run.Direction, OwnerAccountID: owner, FrozenAuthorityEpoch: run.FrozenEpoch, Chats: []ChatMigrationChat{}, DeletionAndSuppressionRecords: []ChatData{}}
		rows, e := tx.Query(ctx, `SELECT chat_id::text,kind,character_ref,group_ref,conversation_id,relationship_id,branch_root::text,revision,metadata_revision,order_revision,message_count,deleted_at IS NOT NULL FROM vc.stored_chat WHERE owner_user_id=$1 ORDER BY chat_id`, owner)
		if e != nil {
			return e
		}
		for rows.Next() {
			var c ChatMigrationChat
			var dead bool
			if e = rows.Scan(&c.OldIdentity, &c.Kind, &c.CharacterRef, &c.GroupRef, &c.ConversationID, &c.RelationshipID, &c.BranchRoot, &c.ChatRevision, &c.MetadataRevision, &c.OrderRevision, &c.MessageCount, &dead); e != nil {
				rows.Close()
				return e
			}
			c.State = "live"
			if dead {
				c.State = "deleted"
			}
			out.Chats = append(out.Chats, c)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if run.Direction == "ST_TO_GO" && len(out.Chats) == 0 {
			// ST has no raw tombstone/ordinal ledger in PG. Return its observed rights
			// but do not invent the absent identities; the archive builder must fail
			// UNAVAILABLE until a complete trusted source supplies those records.
			rows, e = tx.Query(ctx, `SELECT c.st_chat_identity,r.st_character_ref,c.st_mode,c.id,c.relationship_id,c.st_branch_root,c.st_applied_revision,c.st_source_state,c.st_location FROM vc.conversation c JOIN vc.relationship r ON(r.owner_user_id,r.id)=(c.owner_user_id,c.relationship_id) WHERE c.owner_user_id=$1 AND c.st_chat_identity IS NOT NULL ORDER BY c.id`, owner)
			if e != nil {
				return e
			}
			for rows.Next() {
				var c ChatMigrationChat
				var mode, state string
				var root, location *string
				var ref *string
				if e = rows.Scan(&c.OldIdentity, &ref, &mode, &c.ConversationID, &c.RelationshipID, &root, &c.ChatRevision, &state, &location); e != nil {
					rows.Close()
					return e
				}
				c.Kind = "SINGLE"
				c.CharacterRef = ref
				c.BranchRoot = c.OldIdentity
				if root != nil {
					c.BranchRoot = *root
				}
				c.MetadataRevision = 1
				c.OrderRevision = 1
				c.State = "live"
				if state == "DELETED" {
					c.State = "deleted"
				}
				c.PrimaryFileName = c.OldIdentity + ".jsonl"
				if location != nil {
					c.SourceFile = *location
					c.PrimaryFileName = path.Base(*location)
				}
				c.Aliases = []string{c.PrimaryFileName}
				c.MessageAndCandidateIdentityRecords = []ChatMigrationMessage{}
				out.Chats = append(out.Chats, c)
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return e
			}
		}

		tombstones := map[string]bool{}
		rows, e = tx.Query(ctx, `SELECT record_json FROM vc.chat_identity_tombstone WHERE owner_user_id=$1 ORDER BY chat_id`, owner)
		if e != nil {
			return e
		}
		for rows.Next() {
			var raw []byte
			var c ChatMigrationChat
			if e = rows.Scan(&raw); e != nil {
				rows.Close()
				return e
			}
			if e = chatDecode(raw, &c); e != nil {
				rows.Close()
				return e
			}
			out.Chats = append(out.Chats, c)
			var retained struct {
				Rights []ChatData `json:"rights"`
			}
			if e = chatDecode(raw, &retained); e != nil {
				rows.Close()
				return e
			}
			out.DeletionAndSuppressionRecords = append(out.DeletionAndSuppressionRecords, retained.Rights...)
			tombstones[c.OldIdentity] = true
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for i := range out.Chats {
			c := &out.Chats[i]
			if !tombstones[c.OldIdentity] {
				if e = s.migrationChatRecords(ctx, tx, owner, c); e != nil {
					return e
				}
			}
			out.DeletionAndSuppressionRecords = append(out.DeletionAndSuppressionRecords, ChatData{"type": "chat", "chatId": c.OldIdentity, "deleted": c.State == "deleted"})
			for _, m := range c.MessageAndCandidateIdentityRecords {
				out.DeletionAndSuppressionRecords = append(out.DeletionAndSuppressionRecords, ChatData{"type": "message", "chatId": c.OldIdentity, "messageId": m.MessageID, "deleted": m.Deleted})
				for _, v := range m.Candidates {
					out.DeletionAndSuppressionRecords = append(out.DeletionAndSuppressionRecords, ChatData{"type": "candidate", "chatId": c.OldIdentity, "messageId": m.MessageID, "candidateId": v.CandidateID, "deleted": v.Deleted})
				}
			}
			for _, r := range c.SourceRecords {
				copy := copyChatData(r)
				copy["type"] = "source"
				copy["chatId"] = c.OldIdentity
				out.DeletionAndSuppressionRecords = append(out.DeletionAndSuppressionRecords, copy)
			}
		}
		rows, e = tx.Query(ctx, `SELECT i.event_id,i.chat_id::text,i.message_id::text,coalesce(e.link_status,'removed') FROM vc.stored_chat_inbox i LEFT JOIN vc.inbox_event e ON e.owner_user_id=i.owner_user_id AND e.event_id=i.event_id WHERE i.owner_user_id=$1
 UNION ALL SELECT e.event_id,c.st_chat_identity,e.st_message_id,e.link_status FROM vc.inbox_event e JOIN vc.conversation c ON c.owner_user_id=e.owner_user_id AND c.id=e.conversation_id WHERE e.owner_user_id=$1 AND e.st_delivered AND c.st_chat_identity IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc.stored_chat_inbox i WHERE i.owner_user_id=e.owner_user_id AND i.event_id=e.event_id AND i.chat_id::text=c.st_chat_identity) ORDER BY 1`, owner)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var event, chat, message, state string
			if e = rows.Scan(&event, &chat, &message, &state); e != nil {
				return e
			}
			out.DeletionAndSuppressionRecords = append(out.DeletionAndSuppressionRecords, ChatData{"type": "inbox", "eventId": event, "chatId": chat, "messageId": message, "linkStatus": state})
		}
		return rows.Err()
	})
	return out, e
}
func (s *Store) migrationChatRecords(ctx context.Context, tx pgx.Tx, owner int64, c *ChatMigrationChat) error {
	var sum StoredChatSummary
	sum.ChatID = c.OldIdentity
	if e := s.chatAliases(ctx, tx, owner, &sum); e != nil {
		return e
	}
	if sum.FileName != "" {
		c.PrimaryFileName = sum.FileName
		c.Aliases = sum.FileAliases
	}
	rows, e := tx.Query(ctx, `SELECT m.message_id::text,m.revision,m.position,m.selected_candidate_id::text,m.deleted_at IS NOT NULL,c.candidate_id::text,c.ordinal,c.source_revision,c.source_generation,c.settled,c.ever_selected,c.deleted_at IS NOT NULL FROM vc.stored_message m JOIN vc.stored_candidate c USING(owner_user_id,chat_id,message_id) WHERE m.owner_user_id=$1 AND m.chat_id=$2 ORDER BY m.position,c.ordinal`, owner, c.OldIdentity)
	if e != nil {
		return e
	}
	c.MessageAndCandidateIdentityRecords = []ChatMigrationMessage{}
	c.CandidateCount = 0
	for rows.Next() {
		var m ChatMigrationMessage
		var candidate ChatMigrationCandidate
		if e = rows.Scan(&m.MessageID, &m.MessageRevision, &m.Position, &m.SelectedCandidateID, &m.Deleted, &candidate.CandidateID, &candidate.Ordinal, &candidate.SourceRevision, &candidate.SourceGeneration, &candidate.Settled, &candidate.EverSelected, &candidate.Deleted); e != nil {
			rows.Close()
			return e
		}
		if len(c.MessageAndCandidateIdentityRecords) == 0 || c.MessageAndCandidateIdentityRecords[len(c.MessageAndCandidateIdentityRecords)-1].MessageID != m.MessageID {
			m.Candidates = []ChatMigrationCandidate{}
			c.MessageAndCandidateIdentityRecords = append(c.MessageAndCandidateIdentityRecords, m)
		}
		at := len(c.MessageAndCandidateIdentityRecords) - 1
		c.MessageAndCandidateIdentityRecords[at].Candidates = append(c.MessageAndCandidateIdentityRecords[at].Candidates, candidate)
		if !candidate.Deleted {
			c.CandidateCount++
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	c.SourceRecords = []ChatData{}
	if c.ConversationID != nil {
		rows, e = tx.Query(ctx, `SELECT s.message_id::text,s.candidate_id::text,s.source_revision::text,s.source_generation::text,s.settled,s.source_timestamp,s.source_timezone,s.present,s.eligible,s.suppressed,s.conversation_id::text,c.st_applied_revision::text,c.st_branch_root,s.source_position::text FROM vc.st_message_source s JOIN vc.conversation c ON c.owner_user_id=s.owner_user_id AND c.id=s.conversation_id WHERE s.owner_user_id=$1 AND s.conversation_id=$2 ORDER BY s.message_id,s.candidate_id`, owner, *c.ConversationID)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var message, candidate, revision, generation, conversation, applied string
			var settled, present, eligible, suppressed bool
			var timestamp any
			var timezone, branch, position *string
			if e = rows.Scan(&message, &candidate, &revision, &generation, &settled, &timestamp, &timezone, &present, &eligible, &suppressed, &conversation, &applied, &branch, &position); e != nil {
				return e
			}
			c.SourceRecords = append(c.SourceRecords, ChatData{"observed": true, "chatId": c.OldIdentity, "position": position, "messageId": message, "candidateId": candidate, "sourceRevision": revision, "sourceGeneration": generation, "settled": settled, "sourceTimestamp": timestamp, "sourceTimezone": timezone, "present": present, "eligible": eligible, "suppressed": suppressed, "conversationId": conversation, "appliedRevision": applied, "branchRoot": branch})
		}
		if len(c.MessageAndCandidateIdentityRecords) == 0 {
			current := map[string]bool{}
			for _, r := range c.SourceRecords {
				if r["present"] == true {
					current[fmt.Sprint(r["messageId"])] = true
				}
				c.CandidateCount++
			}
			c.MessageCount = int64(len(current))
		}
		return rows.Err()
	}
	// GROUP never gains memory-sharing rights. Its source versions are verifiable
	// directly from raw persisted identities, including deselected/tombstoned ones.
	for _, m := range c.MessageAndCandidateIdentityRecords {
		for _, candidate := range m.Candidates {
			present := !m.Deleted && !candidate.Deleted && m.SelectedCandidateID != nil && *m.SelectedCandidateID == candidate.CandidateID
			c.SourceRecords = append(c.SourceRecords, ChatData{"messageId": m.MessageID, "candidateId": candidate.CandidateID, "sourceRevision": strconv.FormatInt(candidate.SourceRevision, 10), "sourceGeneration": strconv.FormatInt(candidate.SourceGeneration, 10), "settled": candidate.Settled, "sourceTimestamp": nil, "sourceTimezone": nil, "present": present, "eligible": false, "suppressed": m.Deleted || candidate.Deleted, "conversationId": nil, "appliedRevision": strconv.FormatInt(c.ChatRevision, 10), "branchRoot": c.BranchRoot})
		}
	}
	return nil
}

func (s *Store) ReverseExportChatMigration(ctx context.Context, owner int64, runID, chatID string, dst io.Writer) (ChatMigrationChat, error) {
	manifest, e := s.ChatMigrationSupplement(ctx, owner, runID)
	if e != nil {
		return ChatMigrationChat{}, e
	}
	if manifest.Direction != "GO_TO_ST" {
		return ChatMigrationChat{}, ErrInvalid
	}
	for _, c := range manifest.Chats {
		if c.OldIdentity == chatID {
			if c.State == "deleted" {
				return c, nil
			}
			h := sha256.New()
			snapshot, e := s.captureStoredChatJSONL(ctx, owner, chatID, &c.ChatRevision, io.MultiWriter(dst, h), &ChatMigrationRun{RunID: runID, Direction: manifest.Direction, FrozenEpoch: manifest.FrozenAuthorityEpoch})
			if e != nil {
				return ChatMigrationChat{}, e
			}
			c.SourceSHA256 = fmt.Sprintf("%x", h.Sum(nil))
			c.SourceBytes = snapshot.Bytes
			return c, nil
		}
	}
	return ChatMigrationChat{}, ErrNotFound
}

func validateMigrationManifest(owner int64, m ChatMigrationManifest, c ChatMigrationChat) error {
	if m.FormatVersion != 1 || m.OwnerAccountID != owner || m.FrozenAuthorityEpoch <= 0 || m.Direction != "ST_TO_GO" || c.State != "live" && c.State != "deleted" || validateNativeScope(NativeChatScope{c.Kind, c.CharacterRef, c.GroupRef}) != nil || c.ChatRevision <= 0 || c.MetadataRevision <= 0 || c.OrderRevision <= 0 || !validNativeName(c.PrimaryFileName) {
		return ErrInvalid
	}
	if _, e := normalizeChatID(c.OldIdentity); e != nil {
		return e
	}
	if _, e := normalizeChatID(c.BranchRoot); e != nil {
		return e
	}
	for _, alias := range c.Aliases {
		if !validNativeName(alias) {
			return ErrInvalid
		}
	}
	if c.State == "live" && !validTransferHash(c.SourceSHA256) {
		return ErrInvalid
	}
	return nil
}

// Trusted input preserves identities and revisions. It never calls public
// constructors at publication, and does not enqueue historical extraction jobs.
func (s *Store) StageChatMigration(ctx context.Context, owner int64, manifest ChatMigrationManifest, c ChatMigrationChat, source chattransfer.Manifest, objects chattransfer.Objects) error {
	if e := validateMigrationManifest(owner, manifest, c); e != nil {
		return e
	}
	found := false
	e := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		run, e := s.migrationRun(ctx, tx, owner, manifest.MigrationRunID)
		if e != nil {
			return e
		}
		if run.Direction != manifest.Direction || run.FrozenEpoch != manifest.FrozenAuthorityEpoch {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		var hash, record string
		e = tx.QueryRow(ctx, `SELECT source_hash,record_cipher FROM vc.chat_migration_checkpoint WHERE owner_user_id=$1 AND run_id=$2 AND old_identity=$3`, owner, manifest.MigrationRunID, c.OldIdentity).Scan(&hash, &record)
		if errors.Is(e, pgx.ErrNoRows) {
			return nil
		}
		if e != nil {
			return e
		}
		if hash != c.SourceSHA256 {
			return chatError("IDEMPOTENCY_KEY_REUSED")
		}
		var previous ChatMigrationChat
		if e = s.decodeChatJSON(record, &previous); e != nil {
			return e
		}
		if !equalChatValue(asData(previous), asData(c)) {
			return chatError("IDEMPOTENCY_KEY_REUSED")
		}
		found = true
		return nil
	})
	if e != nil || found {
		return e
	}
	// Validate all identities and source-rights records before staging any raw row.
	identities := map[string]ChatMigrationMessage{}
	candidates := map[string]bool{}
	sources := map[string]ChatData{}
	for _, r := range c.SourceRecords {
		for key := range r {
			switch key {
			case "chatId", "messageId", "candidateId", "sourceRevision", "sourceGeneration", "settled", "sourceTimestamp", "sourceTimezone", "present", "eligible", "suppressed", "conversationId", "appliedRevision", "branchRoot", "observed", "position":
			default:
				return ErrInvalid
			}
		}
		message, _ := r["messageId"].(string)
		candidate, _ := r["candidateId"].(string)
		sources[message+"/"+candidate] = r
	}
	for _, m := range c.MessageAndCandidateIdentityRecords {
		if _, e := normalizeChatID(m.MessageID); e != nil || m.MessageRevision <= 0 || m.Position <= 0 {
			return ErrInvalid
		}
		if _, ok := identities[m.MessageID]; ok {
			return chatError("CHAT_IMPORT_INVALID")
		}
		identities[m.MessageID] = m
		for _, v := range m.Candidates {
			if _, e := normalizeChatID(v.CandidateID); e != nil || v.SourceRevision <= 0 || v.SourceGeneration <= 0 || v.Ordinal < 0 {
				return ErrInvalid
			}
			if candidates[v.CandidateID] {
				return chatError("CHAT_IMPORT_INVALID")
			}
			candidates[v.CandidateID] = true
			r := sources[m.MessageID+"/"+v.CandidateID]
			if r == nil || fmt.Sprint(r["sourceRevision"]) != strconv.FormatInt(v.SourceRevision, 10) || fmt.Sprint(r["sourceGeneration"]) != strconv.FormatInt(v.SourceGeneration, 10) {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
		}
	}
	if len(sources) != len(candidates) {
		return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
	}
	for _, r := range manifest.DeletionAndSuppressionRecords {
		if r["chatId"] != c.OldIdentity || r["deleted"] != true {
			continue
		}
		switch r["type"] {
		case "chat":
			if c.State != "deleted" {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
		case "message":
			id, _ := r["messageId"].(string)
			if v, ok := identities[id]; ok && !v.Deleted {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
		case "candidate":
			id, _ := r["messageId"].(string)
			candidate, _ := r["candidateId"].(string)
			for _, v := range identities[id].Candidates {
				if v.CandidateID == candidate && !v.Deleted {
					return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
				}
			}
		}
	}
	intent, e := s.BeginChatTransfer(ctx, owner)
	if e != nil {
		return e
	}
	defer s.ReleaseChatTransfer(ctx, owner, intent.ID)
	writer := chattransfer.NewWriter(ctx, objects, intent.Prefix, 0)
	encoder := json.NewEncoder(writer)
	header, metadata := ChatData{}, ChatData{}
	seen := map[string]bool{}
	if c.State == "live" {
		r, e := chattransfer.NewReader(ctx, objects, source)
		if e != nil {
			return e
		}
		hash := sha256.New()
		counter := &transferCountingReader{Reader: io.TeeReader(r, hash)}
		result, e := chatjsonl.Read(counter, chatjsonl.Handlers{OnHeader: func(h chatjsonl.Object) error {
			header = ChatData(h)
			metadata = asChatData(header["chat_metadata"])
			if metadata == nil {
				metadata = ChatData{}
			}
			delete(header, "chat_metadata")
			for _, d := range []ChatData{header, metadata} {
				delete(d, "vc_f2_parent")
				delete(d, "vc_f2")
				delete(d, "vc_binding")
				delete(d, "vc_branch_root")
			}
			return nil
		}, OnMessage: func(line int, raw chatjsonl.Object) error {
			d := ChatData(raw)
			id, cs, e := transferInputIdentities(d)
			if e != nil || id == nil {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
			identity, ok := identities[*id]
			if !ok || identity.Deleted || seen[*id] {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
			seen[*id] = true
			inputSources := map[string]ChatData{}
			infos, _ := d["swipe_info"].([]any)
			for i, oldCandidate := range cs {
				if oldCandidate == nil {
					continue
				}
				candidateData := d
				if i < len(infos) {
					candidateData = asChatData(infos[i])
				}
				v := asChatData(asChatData(candidateData["extra"])["vc_source"])
				if v == nil {
					v = asChatData(asChatData(d["extra"])["vc_source"])
				}
				if event, ok := v["inbox_event_id"].(string); ok && event != "" {
					verified := false
					for _, right := range manifest.DeletionAndSuppressionRecords {
						if right["type"] == "inbox" && right["chatId"] == c.OldIdentity && right["messageId"] == *id && right["eventId"] == event {
							verified = true
							break
						}
					}
					if !verified {
						return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
					}
				}
				inputSources[*oldCandidate] = copyChatData(v)
			}
			stripTransferIdentities(d)
			m, e := splitNewStoredMessage(ChatAppendMessage{MessageID: *id, Data: d}, identity.Position, true)
			if e != nil {
				return e
			}
			live := []ChatMigrationCandidate{}
			for _, v := range identity.Candidates {
				if !v.Deleted {
					live = append(live, v)
				}
			}
			sort.Slice(live, func(i, j int) bool { return live[i].Ordinal < live[j].Ordinal })
			if len(live) != len(m.Candidates) {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
			row := preparedTransferRow{ID: *id, Position: identity.Position, Revision: identity.MessageRevision, Candidates: []preparedTransferCandidate{}}
			m.Revision = identity.MessageRevision
			for i, v := range live {
				if cs[i] == nil || *cs[i] != v.CandidateID {
					return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
				}
				candidate := &m.Candidates[i]
				candidate.CandidateID = v.CandidateID
				candidate.SourceRevision = v.SourceRevision
				candidate.SourceGeneration = v.SourceGeneration
				candidate.settled = v.Settled
				candidate.everSelected = v.EverSelected
				record := sources[*id+"/"+v.CandidateID]
				extra := asChatData(candidate.Data["extra"])
				originalSource := inputSources[v.CandidateID]
				if originalSource == nil {
					originalSource = ChatData{}
				}
				if _, ok := originalSource["sourceTimestamp"]; !ok {
					originalSource["sourceTimestamp"] = record["sourceTimestamp"]
				}
				if _, ok := originalSource["sourceTimezone"]; !ok {
					originalSource["sourceTimezone"] = record["sourceTimezone"]
				}
				extra["vc_source"] = originalSource
				decorateStoredCandidate(candidate)
				cipher, e := s.encodeChatJSON(candidate.Data)
				if e != nil {
					return e
				}
				row.Candidates = append(row.Candidates, preparedTransferCandidate{v.CandidateID, v.Ordinal, v.SourceRevision, v.SourceGeneration, v.Settled, v.EverSelected, cipher})
			}
			if identity.SelectedCandidateID == nil {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
			m.SelectedCandidateID = *identity.SelectedCandidateID
			row.Selected = m.SelectedCandidateID
			if e = validateStoredMessageDocument(m); e != nil {
				return e
			}
			row.Data, e = s.encodeChatJSON(m.Data)
			if e != nil {
				return e
			}
			return encoder.Encode(row)
		}})
		if e != nil {
			return e
		}
		if !result.Valid() {
			return chatError("CHAT_IMPORT_INVALID")
		}
		if counter.Bytes != c.SourceBytes || fmt.Sprintf("%x", hash.Sum(nil)) != c.SourceSHA256 || result.ValidatedMessages != c.MessageCount || result.ValidatedCandidates != c.CandidateCount {
			return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
		}
	}
	for _, m := range identities {
		if !m.Deleted && !seen[m.MessageID] {
			return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
		}
	}
	prepared, e := writer.Seal()
	if e != nil {
		return e
	}
	header["vc_f2"] = ChatData{"id": c.OldIdentity, "revision": c.ChatRevision}
	header["vc_branch_root"] = c.BranchRoot
	if c.ConversationID != nil {
		mode := ""
		if c.State == "live" {
			if e = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
				return tx.QueryRow(ctx, `SELECT st_mode FROM vc.conversation WHERE owner_user_id=$1 AND id=$2`, owner, *c.ConversationID).Scan(&mode)
			}); e != nil {
				return e
			}
		}
		header["vc_binding"] = ChatData{"chatIdentity": c.OldIdentity, "conversationId": strconv.FormatInt(*c.ConversationID, 10), "relationshipId": strconv.FormatInt(*c.RelationshipID, 10), "characterRef": *c.CharacterRef, "mode": mode}
	}
	h, e := s.encodeChatJSON(header)
	if e != nil {
		return e
	}
	md, e := s.encodeChatJSON(metadata)
	if e != nil {
		return e
	}
	record, e := s.encodeChatJSON(asData(c))
	if e != nil {
		return e
	}
	chatRecord := asData(c)
	if c.State == "deleted" {
		rights := []ChatData{}
		for _, r := range manifest.DeletionAndSuppressionRecords {
			if r["type"] == "inbox" && r["chatId"] == c.OldIdentity {
				event, _ := r["eventId"].(string)
				message, _ := r["messageId"].(string)
				if event == "" || identities[message].MessageID == "" {
					return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
				}
				rights = append(rights, ChatData{"type": "inbox", "eventId": event, "chatId": c.OldIdentity, "messageId": message, "linkStatus": "removed"})
			}
		}
		chatRecord["rights"] = rights
	}
	chatJSON, _ := chatJSON(chatRecord)
	return s.withChatTransfer(ctx, owner, pgx.TxOptions{}, func(ctx context.Context, tx pgx.Tx) error {
		if c.State == "deleted" {
			if _, e := tx.Exec(ctx, `SELECT vc.stage_migration_tombstone($1,$2,$3,$4)`, owner, manifest.MigrationRunID, manifest.FrozenAuthorityEpoch, chatJSON); e != nil {
				return e
			}
			_, e := tx.Exec(ctx, `SELECT vc.checkpoint_migration_chat($1,$2,$3,$4,$5,$6)`, owner, manifest.MigrationRunID, manifest.FrozenAuthorityEpoch, c.OldIdentity, c.SourceSHA256, record)
			return e
		}

		if _, e := tx.Exec(ctx, `SELECT vc.stage_migration_chat($1,$2,$3,$4,$5,$6)`, owner, manifest.MigrationRunID, manifest.FrozenAuthorityEpoch, chatJSON, h, md); e != nil {
			return e
		}
		reader, e := chattransfer.NewReader(ctx, objects, prepared)
		if e != nil {
			return e
		}
		decoder := json.NewDecoder(reader)
		for {
			var row preparedTransferRow
			e = decoder.Decode(&row)
			if errors.Is(e, io.EOF) {
				break
			}
			if e != nil {
				return e
			}
			identity, _ := json.Marshal(identities[row.ID])
			payload, _ := json.Marshal(row)
			if _, e = tx.Exec(ctx, `SELECT vc.stage_migration_message($1,$2,$3,$4,$5,$6)`, owner, manifest.MigrationRunID, manifest.FrozenAuthorityEpoch, c.OldIdentity, identity, payload); e != nil {
				return e
			}
		}
		for _, m := range identities {
			if !m.Deleted {
				continue
			}
			identity, _ := json.Marshal(m)
			if _, e = tx.Exec(ctx, `SELECT vc.stage_migration_message($1,$2,$3,$4,$5,'{}')`, owner, manifest.MigrationRunID, manifest.FrozenAuthorityEpoch, c.OldIdentity, identity); e != nil {
				return e
			}
		}
		inbox := []ChatData{}
		for _, right := range manifest.DeletionAndSuppressionRecords {
			if right["type"] == "inbox" && right["chatId"] == c.OldIdentity {
				inbox = append(inbox, right)
			}
		}
		if len(inbox) > 0 {
			raw, _ := json.Marshal(inbox)
			if _, e = tx.Exec(ctx, `SELECT vc.stage_migration_inbox($1,$2,$3,$4,$5)`, owner, manifest.MigrationRunID, manifest.FrozenAuthorityEpoch, c.OldIdentity, raw); e != nil {
				return e
			}
		}

		_, e = tx.Exec(ctx, `SELECT vc.checkpoint_migration_chat($1,$2,$3,$4,$5,$6)`, owner, manifest.MigrationRunID, manifest.FrozenAuthorityEpoch, c.OldIdentity, c.SourceSHA256, record)
		return e
	})
}

type transferCountingReader struct {
	io.Reader
	Bytes int64
}

func (r *transferCountingReader) Read(p []byte) (int, error) {
	n, e := r.Reader.Read(p)
	r.Bytes += int64(n)
	return n, e
}

func (s *Store) VerifyChatMigration(ctx context.Context, owner int64, manifest ChatMigrationManifest) error {
	if manifest.OwnerAccountID != owner || manifest.FormatVersion != 1 {
		return ErrInvalid
	}
	return s.withChatTransfer(ctx, owner, pgx.TxOptions{}, func(ctx context.Context, tx pgx.Tx) error {
		run, e := s.migrationRun(ctx, tx, owner, manifest.MigrationRunID)
		if e != nil {
			return e
		}
		if run.FrozenEpoch != manifest.FrozenAuthorityEpoch || run.Direction != manifest.Direction {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		if _, e = tx.Exec(ctx, `SELECT vc.require_chat_migration($1,$2,$3)`, owner, run.RunID, run.FrozenEpoch); e != nil {
			return e
		}
		var count int64
		if e = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM vc.stored_chat WHERE owner_user_id=$1)+(SELECT count(*) FROM vc.chat_identity_tombstone WHERE owner_user_id=$1)`, owner).Scan(&count); e != nil {
			return e
		}
		if count != int64(len(manifest.Chats)) {
			return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
		}
		seen := map[string]bool{}
		for _, expected := range manifest.Chats {
			if seen[expected.OldIdentity] {
				return ErrInvalid
			}
			seen[expected.OldIdentity] = true
			var c ChatMigrationChat
			var dead bool
			e = tx.QueryRow(ctx, `SELECT chat_id::text,kind,character_ref,group_ref,conversation_id,relationship_id,branch_root::text,revision,metadata_revision,order_revision,message_count,deleted_at IS NOT NULL FROM vc.stored_chat WHERE owner_user_id=$1 AND chat_id=$2`, owner, expected.OldIdentity).Scan(&c.OldIdentity, &c.Kind, &c.CharacterRef, &c.GroupRef, &c.ConversationID, &c.RelationshipID, &c.BranchRoot, &c.ChatRevision, &c.MetadataRevision, &c.OrderRevision, &c.MessageCount, &dead)
			tombstone := errors.Is(e, pgx.ErrNoRows)
			if tombstone {
				var raw []byte
				if e = tx.QueryRow(ctx, `SELECT record_json FROM vc.chat_identity_tombstone WHERE owner_user_id=$1 AND chat_id=$2`, owner, expected.OldIdentity).Scan(&raw); e != nil {
					return e
				}
				if e = chatDecode(raw, &c); e != nil {
					return e
				}
			} else {
				if e != nil {
					return e
				}
				c.State = "live"
				if dead {
					c.State = "deleted"
				}
				if e = s.migrationChatRecords(ctx, tx, owner, &c); e != nil {
					return e
				}
			}

			c.SourceFile = expected.SourceFile
			c.SourceSHA256 = expected.SourceSHA256
			c.SourceBytes = expected.SourceBytes
			// Compare the complete raw identity, alias and revision inventory. Source
			// suppression can only become stronger, so it is reconciled separately.
			actualSources, wantedSources := c.SourceRecords, expected.SourceRecords
			c.SourceRecords = nil
			expected.SourceRecords = nil
			sort.Strings(c.Aliases)
			sort.Strings(expected.Aliases)
			if !equalChatValue(asData(c), asData(expected)) {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
			if run.Direction == "ST_TO_GO" {
				var hash string
				if e = tx.QueryRow(ctx, `SELECT source_hash FROM vc.chat_migration_checkpoint WHERE owner_user_id=$1 AND run_id=$2 AND old_identity=$3`, owner, run.RunID, c.OldIdentity).Scan(&hash); e != nil {
					return e
				}
				if hash != expected.SourceSHA256 {
					return chatError("IDEMPOTENCY_KEY_REUSED")
				}
			}
			sourceIndex := map[string]ChatData{}
			for _, record := range actualSources {
				sourceIndex[fmt.Sprint(record["messageId"])+"/"+fmt.Sprint(record["candidateId"])] = record
			}
			if len(sourceIndex) != len(wantedSources) {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
			for _, wanted := range wantedSources {
				actual := sourceIndex[fmt.Sprint(wanted["messageId"])+"/"+fmt.Sprint(wanted["candidateId"])]
				if actual == nil {
					return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
				}
				for _, key := range []string{"sourceRevision", "sourceGeneration", "settled", "present", "eligible", "conversationId", "branchRoot", "appliedRevision"} {
					if !equalChatValue(asData(ChatData{"v": actual[key]}), asData(ChatData{"v": wanted[key]})) {
						return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
					}
				}
				if fmt.Sprint(actual["appliedRevision"]) != strconv.FormatInt(c.ChatRevision, 10) {
					return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
				}
			}
			// Every raw candidate, including tombstones, needs independently verifiable
			// source state. Missing evidence is UNAVAILABLE, never assumed DELETED.
			candidateTotal := 0
			for _, m := range c.MessageAndCandidateIdentityRecords {
				for _, candidate := range m.Candidates {
					candidateTotal++
					record := sourceIndex[m.MessageID+"/"+candidate.CandidateID]
					if record == nil || fmt.Sprint(record["sourceRevision"]) != strconv.FormatInt(candidate.SourceRevision, 10) || fmt.Sprint(record["sourceGeneration"]) != strconv.FormatInt(candidate.SourceGeneration, 10) {
						return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
					}
				}
			}
			if candidateTotal != len(sourceIndex) {
				return chatError("CHAT_MIGRATION_SOURCE_UNAVAILABLE")
			}
		}
		rights, e := chatJSON(manifest.DeletionAndSuppressionRecords)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `SELECT vc.merge_migration_rights($1,$2,$3,$4)`, owner, run.RunID, run.FrozenEpoch, rights); e != nil {
			return e
		}
		encrypted, e := s.encodeChatJSON(asData(manifest))
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `SELECT vc.verify_chat_migration($1,$2,$3,$4)`, owner, run.RunID, run.FrozenEpoch, encrypted)
		return e
	})
}
