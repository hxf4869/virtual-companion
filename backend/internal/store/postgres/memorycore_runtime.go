package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/jackc/pgx/v5"
)

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
	Records      []EngineRecord `json:"records"`
	Targets      []EngineTarget `json:"targets"`
	Dependencies []string       `json:"dependencies"`
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
	ids := []string{}
	for id := range candidates {
		ids = append(ids, id)
	}
	return ids, nil
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
		if e := tx.QueryRow(ctx, `SELECT 'source-'||id||'-'||source_revision||'-'||source_generation,COALESCE(source_timestamp,clock_timestamp()) FROM vc.st_message_source WHERE owner_user_id=$1 AND id=$2 AND source_ref=$3`, c.OwnerID, c.RefID, op.SourceRef).Scan(&op.SourceKey, &op.Timestamp); e != nil {
			return e
		}
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
