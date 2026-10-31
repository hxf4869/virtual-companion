package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/jackc/pgx/v5"
)

var forgetProfilePattern = regexp.MustCompile(`^forget-[1-9][0-9]*-profile(?:-a[1-9][0-9]*)?$`)
var forgetProfileBasePattern = regexp.MustCompile(`^(forget-[1-9][0-9]*-profile)(?:-a[1-9][0-9]*)?$`)

// IsForgetProfile reports a profile operation created to replace a forgotten fact.
func IsForgetProfile(id string) bool { return forgetProfilePattern.MatchString(id) }

func forgetProfileBase(id string) string {
	match := forgetProfileBasePattern.FindStringSubmatch(id)
	if match == nil {
		return id
	}
	return match[1]
}

func (s *Store) UseMemoryEngine(c *memoryengine.Client) { s.memoryEngine = c }
func EngineScope(owner, relationship int64) memoryengine.Scope {
	return memoryengine.Scope{OwnerID: fmt.Sprint(owner), InstanceID: fmt.Sprint(relationship), Mode: "COMPANION", DomainID: fmt.Sprintf("instance-%d", relationship), ProfileScopeID: "default"}
}
func (s *Store) SyncMemoryEngineScope(ctx context.Context, owner, relationship int64) (memoryengine.Scope, int64, error) {
	scope := EngineScope(owner, relationship)
	var rev int64
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.go_memorycore_scope($1,$2)`, owner, relationship).Scan(&rev)
	})
	if err != nil {
		return scope, rev, err
	}
	err = s.memoryEngine.Call(ctx, "invalidate-scope", map[string]any{"scope": scope, "revision": rev}, nil)
	return scope, rev, err
}

type EngineRecord struct {
	ID       string         `json:"id"`
	Content  string         `json:"content"`
	Version  int64          `json:"version"`
	Metadata map[string]any `json:"metadata"`
}
type EngineTarget struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}
type EngineProposal struct {
	Records          []EngineRecord `json:"records"`
	Targets          []EngineTarget `json:"targets"`
	Dependencies     []string       `json:"dependencies"`
	EmptyDisposition string         `json:"emptyDisposition,omitempty"`
}
type EngineOperation struct {
	ProfileOperationID   string
	ID                   string
	Scope                memoryengine.Scope
	Revision             int64
	State                string
	Proposal             json.RawMessage
	SourceKey, SourceRef string
	Timestamp            time.Time
	SourceTime           *memorytime.Result
	Input                MemoryExtractInput
	Embedding            EmbeddingConfig
	Allowed              []string
}
type engineProjection struct {
	MemoryID    int64
	RecordID    string
	Version     int64
	OperationID string
}

func (s *Store) engineProjections(ctx context.Context, owner, rel int64) ([]engineProjection, error) {
	out := []engineProjection{}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT * FROM vc.go_memorycore_projection($1,$2)`, owner, rel)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var p engineProjection
			if e = rows.Scan(&p.MemoryID, &p.RecordID, &p.Version, &p.OperationID); e != nil {
				return e
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	return out, err
}
func (s *Store) engineAllowed(ctx context.Context, owner, rel, conv int64) ([]string, error) {
	candidates, e := s.engineCandidates(ctx, owner, rel, conv)
	if e != nil {
		return nil, e
	}
	return allowlistIDs(candidates), nil
}

// allowlistIDs sorts record ids. Map iteration would make the same set look
// like a different propose request and fail OPERATION_CONFLICT on retry.
func allowlistIDs(candidates map[string]Memory) []string {
	ids := make([]string, 0, len(candidates))
	for id := range candidates {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}
func (s *Store) PrepareEngineOperation(ctx context.Context, c JobClaim) (EngineOperation, error) {
	var op EngineOperation
	in, e := s.ReadSTMemoryExtractInput(ctx, c.OwnerID, c.JobID, c.RefID)
	if e != nil {
		return op, e
	}
	if !in.ModelEligible {
		return op, ErrInvalid
	}
	op.Input = in
	op.SourceRef = in.SourceRef
	op.Scope, op.Revision, e = s.SyncMemoryEngineScope(ctx, c.OwnerID, in.RelationshipID)
	if e != nil {
		return op, e
	}
	op.Embedding, e = s.ResolveEmbeddingConfig(ctx, c.OwnerID)
	if e != nil {
		return op, e
	}
	if e = s.memoryEngine.Call(ctx, "rebuild-space", map[string]any{"scope": op.Scope, "embedding": op.Embedding}, nil); e != nil {
		return op, e
	}
	op.Allowed, e = s.engineAllowed(ctx, c.OwnerID, in.RelationshipID, in.ConversationID)
	if e != nil {
		return op, e
	}
	e = s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		var sourceAt *time.Time
		var zone string
		if e := tx.QueryRow(ctx, `SELECT 'source-'||id||'-'||source_revision||'-'||source_generation,COALESCE(source_timestamp,clock_timestamp()),source_timestamp,COALESCE(source_timezone,'') FROM vc.st_message_source WHERE owner_user_id=$1 AND id=$2 AND source_ref=$3`, c.OwnerID, c.RefID, op.SourceRef).Scan(&op.SourceKey, &op.Timestamp, &sourceAt, &zone); e != nil {
			return e
		}
		var at time.Time
		if sourceAt != nil {
			at = *sourceAt
		}
		normalized := memorytime.Normalize(in.UserContent, at, zone)
		op.SourceTime = &normalized
		raw, _ := json.Marshal(op.Scope)
		var attempt int
		if e := tx.QueryRow(ctx, `SELECT attempt_count FROM vc.work_item WHERE owner_user_id=$1 AND id=$2`, c.OwnerID, c.JobID).Scan(&attempt); e != nil {
			return e
		}
		op.ID = fmt.Sprintf("job-%d-r%d-a%d", c.JobID, op.Revision, attempt)
		if _, e := tx.Exec(ctx, `SELECT vc.go_memorycore_reserve($1,$2,$3,$4,$5,$6,$7)`, c.OwnerID, c.JobID, in.RelationshipID, c.RefID, op.ID, raw, op.Revision); e != nil {
			return e
		}
		var savedRev int64
		if e := tx.QueryRow(ctx, `SELECT operation_id,COALESCE(profile_operation_id,operation_id||'-profile'),revision,state,proposal FROM vc.memorycore_operation WHERE owner_user_id=$1 AND job_id=$2`, c.OwnerID, c.JobID).Scan(&op.ID, &op.ProfileOperationID, &savedRev, &op.State, &op.Proposal); e != nil {
			return e
		}
		if savedRev != op.Revision || op.State == "REVOKED" {
			return ErrConflict
		}
		return nil
	})
	return op, mapStoreErr(e)
}

// PrepareForgetProfile loads a forget-rebuild marker without the source
// eligibility gate. The marker may sit on a source that forgetting suppressed.
func (s *Store) PrepareForgetProfile(ctx context.Context, c JobClaim) (EngineOperation, bool, error) {
	var op EngineOperation
	var profile, sourceRef string
	var proposal []byte
	var rel, conv int64
	err := s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT op.operation_id, COALESCE(op.profile_operation_id,''), op.revision, op.state,
			COALESCE(op.proposal, 'null'::jsonb), op.relationship_id, src.conversation_id, src.source_ref,
			COALESCE(src.source_timestamp, clock_timestamp())
			FROM vc.memorycore_operation op
			JOIN vc.st_message_source src ON (src.owner_user_id, src.id) = (op.owner_user_id, op.source_id)
			WHERE op.owner_user_id=$1 AND op.job_id=$2`, c.OwnerID, c.JobID).Scan(
			&op.ID, &profile, &op.Revision, &op.State, &proposal, &rel, &conv, &sourceRef, &op.Timestamp)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return EngineOperation{}, false, nil
	}
	if err != nil {
		return EngineOperation{}, false, mapStoreErr(err)
	}
	if !IsForgetProfile(profile) {
		return EngineOperation{}, false, nil
	}
	op.ProfileOperationID = profile
	if string(proposal) != "null" {
		op.Proposal = json.RawMessage(proposal)
	}
	op.Input.RelationshipID = rel
	op.Input.ConversationID = conv
	op.SourceRef = sourceRef
	op.Scope = EngineScope(c.OwnerID, rel)
	native := int64(0)
	if s.memoryEngine != nil {
		var status struct {
			Revision int64 `json:"revision"`
		}
		if e := s.memoryEngine.Call(ctx, "scope-status", map[string]any{"scope": op.Scope}, &status); e == nil && status.Revision > 0 {
			native = status.Revision
		}
	}
	if native > op.Revision || op.State != "PUBLISHED" {
		next, e := s.applyMemorycoreRebind(ctx, c, op, "", "", native)
		if e != nil {
			return EngineOperation{}, true, e
		}
		next.Input = op.Input
		next.SourceRef = op.SourceRef
		next.Timestamp = op.Timestamp
		next.Embedding = op.Embedding
		next.Allowed = op.Allowed
		if len(next.Proposal) == 0 {
			next.Proposal = op.Proposal
		}
		if next.Scope.OwnerID == "" {
			next.Scope = op.Scope
		}
		return next, true, nil
	}
	if s.memoryEngine != nil {
		if e := s.memoryEngine.Call(ctx, "invalidate-scope", map[string]any{"scope": op.Scope, "revision": op.Revision}, nil); e != nil {
			return EngineOperation{}, true, e
		}
	}
	return op, true, nil
}

// RebindEngineOperation adopts the current scope revision. A published or
// forget profile keeps its extract operation and rotates only the profile id.
// An unpublished extract gets a new operation id so the next propose is not
// rejected as a stale request.
func (s *Store) RebindEngineOperation(ctx context.Context, c JobClaim, op EngineOperation) (EngineOperation, error) {
	native := int64(0)
	if s.memoryEngine != nil && op.Scope.OwnerID != "" {
		var status struct {
			Revision int64 `json:"revision"`
		}
		if e := s.memoryEngine.Call(ctx, "scope-status", map[string]any{"scope": op.Scope}, &status); e == nil && status.Revision > 0 {
			native = status.Revision
		}
	}
	nextOperation := ""
	nextProfile := ""
	if op.State == "PUBLISHED" || IsForgetProfile(op.ProfileOperationID) {
		nextProfile = rotatedProfileID(op)
	} else {
		rev := op.Revision
		if native > rev {
			rev = native
		}
		nextOperation = fmt.Sprintf("job-%d-r%d-b%d", c.JobID, rev, time.Now().UnixNano())
	}
	return s.applyMemorycoreRebind(ctx, c, op, nextOperation, nextProfile, native)
}

func rotatedProfileID(op EngineOperation) string {
	stamp := strconv.FormatInt(time.Now().UnixNano(), 10)
	if IsForgetProfile(op.ProfileOperationID) {
		return forgetProfileBase(op.ProfileOperationID) + "-a" + stamp
	}
	base := op.ID
	if base == "" {
		base = "profile"
	}
	return fmt.Sprintf("%s-profile-a%s", base, stamp)
}

func (s *Store) applyMemorycoreRebind(ctx context.Context, c JobClaim, op EngineOperation, nextOperation, nextProfile string, native int64) (EngineOperation, error) {
	var operationID, profileID, state string
	var revision, rel, conv int64
	err := s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_operation, out_profile, out_revision, out_state, out_relationship, out_conversation
			FROM vc.go_memorycore_rebind($1,$2,$3,$4,$5,$6,$7)`,
			c.OwnerID, c.JobID, c.Token, c.Fence, nextOperation, nextProfile, native).Scan(
			&operationID, &profileID, &revision, &state, &rel, &conv)
	})
	if err != nil {
		return EngineOperation{}, mapStoreErr(err)
	}
	if op.Input.RelationshipID == 0 {
		op.Input.RelationshipID = rel
	}
	if op.Input.ConversationID == 0 {
		op.Input.ConversationID = conv
	}
	op.ID = operationID
	op.Revision = revision
	op.State = state
	if profileID != "" {
		op.ProfileOperationID = profileID
	} else if state == "NEW" && operationID != "" {
		op.ProfileOperationID = operationID + "-profile"
	}
	if state == "NEW" {
		op.Proposal = nil
	}
	if op.Scope.OwnerID == "" {
		op.Scope = EngineScope(c.OwnerID, rel)
	}
	if s.memoryEngine != nil {
		if e := s.memoryEngine.Call(ctx, "invalidate-scope", map[string]any{"scope": op.Scope, "revision": revision}, nil); e != nil {
			return EngineOperation{}, e
		}
	}
	return op, nil
}

func (s *Store) EngineCall(ctx context.Context, action string, in, out any) error {
	return s.memoryEngine.Call(ctx, action, in, out)
}

// ValidateEngineProposal derives dependencies from trusted source rows and old
// target evidence. Model-supplied dependency IDs are checked, never authorized.
func (s *Store) ValidateEngineProposal(ctx context.Context, c JobClaim, op EngineOperation, raw json.RawMessage) ([]string, error) {
	var p EngineProposal
	if json.Unmarshal(raw, &p) != nil || len(p.Records) > 100 {
		return nil, ErrInvalid
	}
	in, e := s.ReadSTMemoryExtractInput(ctx, c.OwnerID, c.JobID, c.RefID)
	if e != nil {
		return nil, e
	}
	if !in.ModelEligible || in.SourceRef != op.SourceRef {
		return nil, ErrConflict
	}
	embedding, e := s.ResolveEmbeddingConfig(ctx, c.OwnerID)
	if e != nil {
		return nil, e
	}
	if embedding.SpaceID != op.Embedding.SpaceID || embedding.Revision != op.Embedding.Revision {
		return nil, ErrConflict
	}
	current, e := s.engineCandidates(ctx, c.OwnerID, in.RelationshipID, in.ConversationID)
	if e != nil {
		return nil, e
	}
	projections, e := s.engineProjections(ctx, c.OwnerID, in.RelationshipID)
	if e != nil {
		return nil, e
	}
	versions := map[string]int64{}
	for _, v := range projections {
		versions[v.RecordID] = v.Version
	}
	refs := []string{op.SourceRef}
	seen := map[string]bool{op.SourceRef: true}
	for _, t := range p.Targets {
		m, ok := current[t.ID]
		if !ok || versions[t.ID] != t.Version {
			return nil, ErrConflict
		}
		for _, ref := range m.Sources {
			if !seen[ref] {
				refs = append(refs, ref)
				seen[ref] = true
			}
		}
	}
	for _, r := range p.Records {
		if r.ID == "" || r.Content == "" || len(r.Content) > 16000 || r.Version < 1 {
			return nil, ErrInvalid
		}
	}
	if e = s.reconcileSTEvidence(ctx, c.OwnerID, refs); e != nil {
		return nil, e
	}
	e = s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		var valid bool
		if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.memorycore_scope s JOIN vc.work_item w ON w.owner_user_id=s.owner_user_id WHERE s.owner_user_id=$1 AND s.relationship_id=$2 AND s.revision=$3 AND w.id=$4 AND w.status='CLAIMED' AND w.claim_token=$5 AND w.claim_fence=$6 AND w.lease_expires_at>clock_timestamp())`, c.OwnerID, in.RelationshipID, op.Revision, c.JobID, c.Token, c.Fence).Scan(&valid); e != nil {
			return e
		}
		if !valid {
			return ErrConflict
		}
		deps := map[string]bool{}
		for _, ref := range refs {
			var key string
			var valid bool
			if e := tx.QueryRow(ctx, `SELECT 'source-'||id||'-'||source_revision||'-'||source_generation,vc.guard_st_memory_source($1,$2,source_ref) FROM vc.st_message_source WHERE owner_user_id=$1 AND source_ref=$3`, c.OwnerID, in.RelationshipID, ref).Scan(&key, &valid); e != nil {
				return e
			}
			if !valid {
				return ErrConflict
			}
			deps[key] = true
		}
		if len(deps) != len(p.Dependencies) {
			return ErrInvalid
		}
		for _, key := range p.Dependencies {
			if !deps[key] {
				return ErrInvalid
			}
		}
		_, e := tx.Exec(ctx, `SELECT vc.go_memorycore_stage($1,$2,$3)`, c.OwnerID, c.JobID, raw)
		return e
	})
	return refs, mapStoreErr(e)
}
func (s *Store) PublishEngineProposal(ctx context.Context, c JobClaim, op EngineOperation, raw json.RawMessage) error {
	refs, e := s.ValidateEngineProposal(ctx, c, op, raw)
	if e != nil {
		return e
	}
	return mapStoreErr(s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `SELECT vc.go_publish_memorycore($1,$2,$3,$4,$5,$6)`, c.OwnerID, c.JobID, c.Token, c.Fence, raw, refs); e != nil {
			return e
		}
		rows, e := tx.Query(ctx, `SELECT memory_id FROM vc.go_memorycore_projection($1,$2) WHERE operation_id=$3`, c.OwnerID, op.Input.RelationshipID, op.ID)
		if e != nil {
			return e
		}
		ids := []int64{}
		for rows.Next() {
			var id int64
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return e
			}
			ids = append(ids, id)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if len(ids) == 0 {
			var clarified int64
			if clarified, e = s.clarificationMemory(ctx, tx, c, op); e != nil {
				return e
			}
			if clarified > 0 {
				ids = append(ids, clarified)
			}
		}
		for _, id := range ids {
			if e = s.writeVerifiedSourceTime(ctx, tx, c.OwnerID, id, op.Input.UserContent, c.RefID); e != nil {
				return e
			}
		}
		return nil
	}))
}

// clarificationMemory records one needs_clarification row when the engine
// publishes no record for an ambiguous verified source. A clear "no new fact"
// proposal stays empty. The same operation never inserts a second row.
func (s *Store) clarificationMemory(ctx context.Context, tx pgx.Tx, c JobClaim, op EngineOperation) (int64, error) {
	var at *time.Time
	var zone *string
	if e := tx.QueryRow(ctx, `SELECT source_timestamp, source_timezone FROM vc.st_message_source WHERE owner_user_id=$1 AND id=$2`, c.OwnerID, c.RefID).Scan(&at, &zone); e != nil {
		return 0, e
	}
	var stamp time.Time
	var name string
	if at != nil {
		stamp = *at
	}
	if zone != nil {
		name = *zone
	}
	if memorytime.Normalize(op.Input.UserContent, stamp, name).NormalizationStatus != memorytime.StatusNeedsClarification {
		return 0, nil
	}
	var id int64
	if e := tx.QueryRow(ctx, `SELECT vc.go_memorycore_clarification($1,$2,$3,$4,$5)`, c.OwnerID, c.JobID, c.Token, c.Fence, op.Input.UserContent).Scan(&id); e != nil {
		return 0, e
	}
	return id, nil
}

func (s *Store) AbandonEngineOperation(ctx context.Context, c JobClaim) error {
	return s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.go_memorycore_failed($1,$2,$3,$4)`, c.OwnerID, c.JobID, c.Token, c.Fence)
		return e
	})
}

func (s *Store) RecordEmptyExtractDecision(ctx context.Context, owner, job int64, code string) error {
	return s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.go_record_memorycore_empty_decision($1,$2,$3)`, owner, job, code)
		return e
	})
}
