package postgres

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/jackc/pgx/v5"
)

const extractionWindowMessages = 6
const extractionWindowBytes = 24000

// EngineExtractionMessage is internal Go-to-engine input, not a source protocol.
type EngineExtractionMessage struct {
	ID                string             `json:"id"`
	Content           string             `json:"content"`
	Role              string             `json:"role"`
	Timestamp         string             `json:"timestamp"`
	TimestampFallback *bool              `json:"timestampFallback,omitempty"`
	SourceTime        *memorytime.Result `json:"sourceTime,omitempty"`
}

type extractionSource struct {
	EngineExtractionMessage
	ref      string
	eligible bool
}

// ReadEngineExtractionWindow consumes only the mirror already reconciled by
// PrepareEngineOperation. It never adds a source-reader or ST read-back path.
func (s *Store) ReadEngineExtractionWindow(ctx context.Context, c JobClaim, op EngineOperation) ([]EngineExtractionMessage, error) {
	var messages []EngineExtractionMessage
	err := s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		window, err := engineExtractionWindow(ctx, tx, c.OwnerID, c.RefID, op.SourceRef)
		if err != nil {
			return err
		}
		if len(window) == 0 || window[len(window)-1].ID != op.SourceKey {
			return ErrConflict
		}
		for _, source := range window {
			messages = append(messages, source.EngineExtractionMessage)
		}
		return nil
	})
	return messages, mapStoreErr(err)
}

func engineExtractionWindow(ctx context.Context, tx pgx.Tx, owner, sourceID int64, sourceRef string) ([]extractionSource, error) {
	rows, err := tx.Query(ctx, `
		SELECT 'source-'||s.id||'-'||s.source_revision||'-'||s.source_generation,
		       s.source_ref,s.role,s.content_cipher,COALESCE(s.source_timestamp,c.created_at),
		       s.source_timestamp,COALESCE(s.source_timezone,''),s.settled AND s.eligible AND NOT s.suppressed
		FROM vc.st_message_source anchor
		JOIN vc.conversation c ON (c.owner_user_id,c.id)=(anchor.owner_user_id,anchor.conversation_id)
		JOIN vc.st_message_source s ON (s.owner_user_id,s.conversation_id)=(c.owner_user_id,c.id)
		WHERE anchor.owner_user_id=$1 AND anchor.id=$2 AND anchor.source_ref=$3
		  AND anchor.role='user' AND anchor.present AND anchor.settled AND anchor.eligible AND NOT anchor.suppressed
		  AND c.st_mode='COMPANION' AND c.st_source_state='PRESENT' AND NOT c.incognito
		  AND s.present AND s.source_position<=anchor.source_position
		ORDER BY s.source_position DESC,s.id DESC LIMIT $4`, owner, sourceID, sourceRef, extractionWindowMessages)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sources []extractionSource
	for rows.Next() {
		var source extractionSource
		var at time.Time
		var sourceAt *time.Time
		var zone string
		if err := rows.Scan(&source.ID, &source.ref, &source.Role, &source.Content, &at, &sourceAt, &zone, &source.eligible); err != nil {
			return nil, err
		}
		// Missing source timestamps use a stable bookkeeping time only.
		source.Timestamp = at.UTC().Format(time.RFC3339Nano)
		timestampFallback := sourceAt == nil
		source.TimestampFallback = &timestampFallback
		if source.Role == "user" && source.eligible {
			var stamp time.Time
			if sourceAt != nil {
				stamp = *sourceAt
			}
			sourceTime := memorytime.Normalize(source.Content, stamp, zone)
			source.SourceTime = &sourceTime
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	window := boundExtractionWindow(sources)
	if len(window) == 0 || window[len(window)-1].ref != sourceRef {
		return nil, ErrConflict
	}
	return window, nil
}

// Input is newest first. Keep a contiguous suffix: skipping a private or
// oversized message could bind a confirmation to the wrong earlier subject.
// Preserve the anchor intact even if it alone exceeds the context budget.
func boundExtractionWindow(sources []extractionSource) []extractionSource {
	if len(sources) == 0 || sources[0].Role != "user" || !sources[0].eligible {
		return nil
	}
	window := make([]extractionSource, 0, extractionWindowMessages)
	bytes := 0
	for _, source := range sources {
		if !source.eligible || (source.Role != "user" && source.Role != "assistant") ||
			len(window) == extractionWindowMessages || (len(window) > 0 && bytes+len(source.Content) > extractionWindowBytes) {
			break
		}
		window = append(window, source)
		bytes += len(source.Content)
	}
	slices.Reverse(window)
	return window
}

type engineProposalSources struct {
	refs              []string
	recordRefs        map[string][]string
	recordPrimaryRefs map[string]string
}

// Called after the owner barrier. The guarded context supplies new citations.
// Only the trusted evidence of a record's own targets may extend that context.
func validateExtractionSupport(ctx context.Context, tx pgx.Tx, c JobClaim, op EngineOperation, relationshipID int64, p EngineProposal, refs []string, targetRefs map[string][]string) (engineProposalSources, error) {
	var result engineProposalSources
	window, err := engineExtractionWindow(ctx, tx, c.OwnerID, c.RefID, op.SourceRef)
	if err != nil {
		return result, err
	}
	if window[len(window)-1].ID != op.SourceKey {
		return result, ErrConflict
	}
	legacy := p.ContextDependencies == nil
	contextKeys := p.ContextDependencies
	if legacy {
		contextKeys = []string{op.SourceKey}
	}
	if len(contextKeys) == 0 || len(contextKeys) > len(window) {
		return result, ErrConflict
	}
	// A replay may have seen a shorter suffix of the current window.
	contextSources := map[string]string{}
	userSources := map[string]bool{}
	for i, source := range window[len(window)-len(contextKeys):] {
		if source.ID != contextKeys[i] {
			return result, ErrConflict
		}
		contextSources[source.ID] = source.ref
		userSources[source.ID] = source.Role == "user"
		if !slices.Contains(refs, source.ref) {
			refs = append(refs, source.ref)
		}
	}
	keys := make(map[string]string, len(refs))
	for _, ref := range refs {
		var key, role string
		var valid bool
		if err := tx.QueryRow(ctx, `SELECT 'source-'||id||'-'||source_revision||'-'||source_generation,role,
			vc.guard_st_memory_source($1,$2,source_ref) FROM vc.st_message_source WHERE owner_user_id=$1 AND source_ref=$3`,
			c.OwnerID, relationshipID, ref).Scan(&key, &role, &valid); err != nil {
			return result, err
		}
		if !valid {
			return result, ErrConflict
		}
		// Inheritance cannot extend the authorized assistant window.
		if role != "user" && (role != "assistant" || contextSources[key] != ref) {
			return result, ErrInvalid
		}
		keys[ref] = key
	}

	var legacyTargetIDs []string
	if legacy {
		// Persisted singleton proposals used every target for every record.
		for _, target := range p.Targets {
			legacyTargetIDs = append(legacyTargetIDs, target.ID)
		}
	}
	result.recordRefs = make(map[string][]string, len(p.Records))
	result.recordPrimaryRefs = make(map[string]string, len(p.Records))
	union := map[string]bool{}
	linkedTargets := map[string]bool{}
	for _, record := range p.Records {
		if _, duplicate := result.recordRefs[record.ID]; duplicate {
			return engineProposalSources{}, ErrInvalid
		}
		targetIDs := record.ConflictTargetIDs
		if legacy {
			targetIDs = legacyTargetIDs
		}
		inherited := map[string]string{}
		seenTargets := map[string]bool{}
		for _, id := range targetIDs {
			evidence, ok := targetRefs[id]
			if !ok || seenTargets[id] {
				return engineProposalSources{}, ErrInvalid
			}
			seenTargets[id], linkedTargets[id] = true, true
			for _, ref := range evidence {
				inherited[keys[ref]] = ref
			}
		}
		seen := map[string]bool{}
		recordRefs := make([]string, 0, len(record.SourceMessageIDs))
		for _, id := range record.SourceMessageIDs {
			ref := inherited[id]
			if ref == "" {
				ref = contextSources[id]
			}
			if ref == "" || seen[id] {
				return engineProposalSources{}, ErrInvalid
			}
			seen[id] = true
			recordRefs = append(recordRefs, ref)
			if !union[id] {
				result.refs = append(result.refs, ref)
				union[id] = true
			}
		}
		for id := range inherited {
			if !seen[id] {
				return engineProposalSources{}, ErrInvalid
			}
		}
		primary := op.SourceKey
		if !legacy {
			primary, _ = record.Metadata["vcPrimarySourceId"].(string)
		}
		if !seen[primary] || !userSources[primary] || (!legacy && !matchesEvidenceMetadata(record)) {
			return engineProposalSources{}, ErrInvalid
		}
		result.recordRefs[record.ID] = recordRefs
		result.recordPrimaryRefs[record.ID] = contextSources[primary]
	}

	if len(linkedTargets) != len(targetRefs) {
		return engineProposalSources{}, ErrInvalid
	}
	if len(p.Records) == 0 {
		// Empty publication keeps the existing anchor guard and creates no evidence.
		result.refs = []string{op.SourceRef}
		if legacy {
			union[op.SourceKey] = true
		}
	}
	if len(union) != len(p.Dependencies) {
		return engineProposalSources{}, ErrInvalid
	}
	for _, key := range p.Dependencies {
		if !union[key] {
			return engineProposalSources{}, ErrInvalid
		}
		delete(union, key)
	}
	return result, nil
}

func matchesEvidenceMetadata(record EngineRecord) bool {
	dependencies, ok := record.Metadata["vcDependencies"].([]any)
	if !ok || len(dependencies) != len(record.SourceMessageIDs) {
		return false
	}
	for i, id := range record.SourceMessageIDs {
		if dependencies[i] != id {
			return false
		}
	}
	return true
}

// Older durable singleton proposals bind every target to every output record.
// Make that already-validated mapping explicit for V292 without rewriting any
// native fields (vectors, timestamps and extension metadata remain intact).
func enginePublicationProposal(raw json.RawMessage) (json.RawMessage, error) {
	var proposal map[string]json.RawMessage
	if err := json.Unmarshal(raw, &proposal); err != nil {
		return nil, err
	}
	if _, current := proposal["contextDependencies"]; current {
		return raw, nil
	}
	var targets []EngineTarget
	if err := json.Unmarshal(proposal["targets"], &targets); err != nil && len(proposal["targets"]) > 0 {
		return nil, err
	}
	if len(targets) == 0 {
		return raw, nil
	}
	ids := make([]string, 0, len(targets))
	for _, target := range targets {
		ids = append(ids, target.ID)
	}
	encoded, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	var records []map[string]json.RawMessage
	if err := json.Unmarshal(proposal["records"], &records); err != nil {
		return nil, err
	}
	for _, record := range records {
		record["conflictTargetIds"] = encoded
	}
	proposal["records"], err = json.Marshal(records)
	if err != nil {
		return nil, err
	}
	return json.Marshal(proposal)
}
