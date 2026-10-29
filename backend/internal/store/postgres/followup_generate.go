package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrFollowUpNoPrice means the greeting profile or the ledger has no unit price.
// Nil prices are unknown, never free.
var ErrFollowUpNoPrice = errors.New("follow-up model price is unknown")

// ErrFollowUpBudget means monthly admission or the configured ceiling refused
// the greeting before any provider request.
var ErrFollowUpBudget = errors.New("follow-up model budget denied")

// FollowUpGeneration is the worker view of one follow-up at claim time.
// Body is the topic. Greeting is the model text, and it is empty unless the
// row is BODY_READY.
type FollowUpGeneration struct {
	ID               int64
	RelationshipID   int64
	Status           string
	Body             string
	EventID          string
	Deliverable      string
	Greeting         *string
	Outcome          *string
	Reason           *string
	SourceValid      bool
	PolicyEnabled    bool
	OfflineCapable   bool
	CompanionName    *string
	UserAddressAs    *string
	ReplyLength      string
	Initiative       string
	Humor            string
	AdvicePref       string
	MemoryShareScope string
	AvoidTopics      []string
	Gender           string
	MemoryItemID     *int64
	SourceRef        *string
	SourceRevision   *int64
	ProviderID       *string
	ModelID          *string
	Protocol         *string
	ProviderRevision *int64
	BindingRevision  *int64
	Params           json.RawMessage
	// AttemptCount is the live FOLLOW_UP work item's attempt_count. The
	// greeting ledger key includes it. Zero means no PENDING or CLAIMED job.
	AttemptCount int
	// Deferrals is how many generation holds are already stored. DeferredUntil
	// is set only while the latest hold is still waiting.
	Deferrals     int
	DeferredUntil *time.Time
}

// FollowUpGenerationFinish records one generation outcome. Greeting is stored
// only for BODY_READY. Provider fields are the frozen route and never include
// a credential.
type FollowUpGenerationFinish struct {
	Outcome          string
	Reason           string
	Greeting         *string
	ProviderID       string
	ModelID          string
	Protocol         string
	ProviderRevision *int64
	BindingRevision  *int64
	Params           json.RawMessage
	// Now is the worker clock for a NOT_GENERATED or POLICY_DISABLED hold.
	// Zero uses the database clock. The event date, clock, and timezone are
	// never arguments of a hold.
	Now time.Time
}

func (s *Store) LoadFollowUpGeneration(ctx context.Context, owner, id int64) (FollowUpGeneration, error) {
	var out FollowUpGeneration
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var greeting, outcome, reason, name, address, sourceRef pgtype.Text
		var providerID, modelID, protocol pgtype.Text
		var memoryID, sourceRevision, providerRevision, bindingRevision pgtype.Int8
		var avoid pgtype.Text
		var params []byte
		err := tx.QueryRow(ctx, `
			SELECT out_id, out_relationship_id, out_status, out_body, out_event_id,
			       out_deliverable, out_greeting, out_outcome, out_reason,
			       out_source_valid, out_policy_enabled, out_offline_capable,
			       out_companion_name, out_user_address_as, out_reply_length,
			       out_initiative, out_humor, out_advice_pref, out_memory_share_scope,
			       out_avoid_topics, out_gender, out_memory_item_id, out_source_ref,
			       out_source_revision, out_provider_id, out_model_id, out_protocol,
			       out_provider_revision, out_binding_revision, out_params
			  FROM vc.load_follow_up_generation($1,$2)`, owner, id).Scan(
			&out.ID, &out.RelationshipID, &out.Status, &out.Body, &out.EventID,
			&out.Deliverable, &greeting, &outcome, &reason,
			&out.SourceValid, &out.PolicyEnabled, &out.OfflineCapable,
			&name, &address, &out.ReplyLength, &out.Initiative, &out.Humor,
			&out.AdvicePref, &out.MemoryShareScope, &avoid, &out.Gender,
			&memoryID, &sourceRef, &sourceRevision, &providerID, &modelID, &protocol,
			&providerRevision, &bindingRevision, &params)
		if err != nil {
			return err
		}
		out.Greeting = textPtr(greeting)
		out.Outcome = textPtr(outcome)
		out.Reason = textPtr(reason)
		out.CompanionName = textPtr(name)
		out.UserAddressAs = textPtr(address)
		out.AvoidTopics = splitCSV(textPtr(avoid))
		out.MemoryItemID = int8Ptr(memoryID)
		out.SourceRef = textPtr(sourceRef)
		out.SourceRevision = int8Ptr(sourceRevision)
		out.ProviderID = textPtr(providerID)
		out.ModelID = textPtr(modelID)
		out.Protocol = textPtr(protocol)
		out.ProviderRevision = int8Ptr(providerRevision)
		out.BindingRevision = int8Ptr(bindingRevision)
		if len(params) > 0 {
			out.Params = json.RawMessage(params)
		}
		return tx.QueryRow(ctx, `
			SELECT COALESCE((
				SELECT wi.attempt_count
				  FROM vc.work_item wi
				 WHERE wi.owner_user_id = $1
				   AND wi.kind = 'FOLLOW_UP'
				   AND wi.ref_id = $2
				   AND wi.status IN ('PENDING', 'CLAIMED')
				 ORDER BY wi.id DESC
				 LIMIT 1), 0)`, owner, id).Scan(&out.AttemptCount)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return FollowUpGeneration{}, ErrNotFound
	}
	if err != nil {
		return FollowUpGeneration{}, mapFollowUpGenErr(err)
	}
	return out, nil
}

func (s *Store) FinishFollowUpGeneration(ctx context.Context, owner, id int64, in FollowUpGenerationFinish) error {
	var params any
	if len(in.Params) > 0 {
		params = string(in.Params)
	}
	var now any
	if !in.Now.IsZero() {
		now = in.Now
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			SELECT vc.finish_follow_up_generation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
			owner, id, in.Outcome, in.Reason, in.Greeting,
			nullIfBlank(in.ProviderID), nullIfBlank(in.ModelID), nullIfBlank(in.Protocol),
			in.ProviderRevision, in.BindingRevision, params, now)
		return err
	})
	return mapFollowUpGenErr(err)
}

func (s *Store) PrepareFollowUpModelCall(ctx context.Context, owner, jobID int64, attempt, provider, model string, inputTokens, outputTokens int) (string, error) {
	if s == nil || s.maxReservedCost <= 0 || s.monthlyCostLimit <= 0 {
		return "", ErrFollowUpBudget
	}
	var decision string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT vc.prepare_follow_up_model_call($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			owner, jobID, attempt, provider, model, inputTokens, outputTokens,
			s.maxReservedCost, s.monthlyCostLimit).Scan(&decision)
	})
	if err != nil {
		return "", mapFollowUpGenErr(err)
	}
	return decision, nil
}

func (s *Store) SettleFollowUpModelCall(ctx context.Context, owner int64, attempt, disposition string, inputTokens, outputTokens *int64) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var paid pgtype.Int8
		return tx.QueryRow(ctx, `
			SELECT vc.settle_follow_up_model_call($1,$2,$3,$4,$5)`,
			owner, attempt, disposition, inputTokens, outputTokens).Scan(&paid)
	})
	return mapFollowUpGenErr(err)
}

// FollowUpProviderCredential re-reads the enabled credential for the frozen
// provider revision. A missing, disabled, or cleared key is ErrNotFound.
func (s *Store) FollowUpProviderCredential(ctx context.Context, providerID string, revision int64) (string, error) {
	providerID = strings.TrimSpace(providerID)
	if s == nil || revision < 0 || !validProviderID(providerID) {
		return "", ErrInvalid
	}
	var stored pgtype.Text
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.follow_up_provider_credential($1,$2)`, providerID, revision).Scan(&stored)
	})
	if err != nil {
		return "", mapFollowUpGenErr(err)
	}
	if !stored.Valid || strings.TrimSpace(stored.String) == "" {
		return "", ErrNotFound
	}
	plain, err := s.decryptStored(stored.String)
	if err != nil || strings.TrimSpace(plain) == "" {
		return "", errStore
	}
	return plain, nil
}

func mapFollowUpGenErr(err error) error {
	if err == nil || errors.Is(err, ErrFollowUpNoPrice) || errors.Is(err, ErrFollowUpBudget) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" {
		switch {
		case strings.Contains(pgErr.Message, "unit price is unknown"):
			return ErrFollowUpNoPrice
		case strings.Contains(pgErr.Message, "limits are not configured"),
			strings.Contains(pgErr.Message, "ceiling is too small"),
			strings.Contains(pgErr.Message, "monthly cost hard cap"):
			return ErrFollowUpBudget
		}
	}
	return mapFollowUpErr(err)
}
