package postgres

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	ProtocolOpenAIChat      = "OPENAI_CHAT_COMPLETIONS"
	ProtocolOpenAIResponses = "OPENAI_RESPONSES"
	ProtocolAnthropic       = "ANTHROPIC_MESSAGES"

	ProviderEnabled  = "ENABLED"
	ProviderDisabled = "DISABLED"

	credentialKeep  = "KEEP"
	credentialSet   = "SET"
	credentialClear = "CLEAR"

	PurposeForegroundChat      = "FOREGROUND_CHAT"
	PurposeMemoryExtraction    = "MEMORY_EXTRACTION_DEDUP_SUMMARY"
	PurposeBackgroundGreetings = "BACKGROUND_GREETINGS"
	PurposeStoryDirector       = "STORY_DIRECTOR"
	PurposeNPCDialogue         = "NPC_DIALOGUE"
	PurposeEmbedding           = "EMBEDDING"

	BindingPending     = "PENDING_CONFIGURATION"
	BindingDisabled    = "DISABLED"
	BindingUnavailable = "UNAVAILABLE"
	BindingReady       = "READY"

	CapabilityUnknown     = "UNKNOWN"
	CapabilityDeclared    = "DECLARED"
	CapabilityVerified    = "VERIFIED"
	CapabilityUnsupported = "UNSUPPORTED"
)

// Purposes is the fixed binding set in catalog order.
var Purposes = []string{
	PurposeForegroundChat, PurposeMemoryExtraction, PurposeBackgroundGreetings,
	PurposeStoryDirector, PurposeNPCDialogue, PurposeEmbedding,
}

// CapabilityKeys are the declared/verified/unknown capability slots of a
// profile. Text input is implicit and not recorded.
var CapabilityKeys = []string{
	"imageInput", "videoInput", "pdfInput", "structuredOutput",
	"toolCalls", "nativeWebSearch", "systemMessage", "temperature", "topP",
}

var (
	reasoningLevelPattern = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
	currencyPattern       = regexp.MustCompile(`^[A-Z]{3}$`)
)

// ModelCapabilities maps every CapabilityKeys entry to a capability status.
type ModelCapabilities map[string]string

// GenerationParams is the bounded, protocol-independent request parameter set
// a profile pins. Protocol mapping happens in the SillyTavern server plugin.
type GenerationParams struct {
	Temperature     *float64 `json:"temperature"`
	TopP            *float64 `json:"topP"`
	ReasoningEffort *string  `json:"reasoningEffort"`
}

// ModelPricing is optional metadata; nil values mean unknown, never free.
type ModelPricing struct {
	Currency               *string  `json:"currency"`
	InputPerMillionTokens  *float64 `json:"inputPerMillionTokens"`
	OutputPerMillionTokens *float64 `json:"outputPerMillionTokens"`
	VerifiedOn             *string  `json:"verifiedOn"`
}

// Ledger status of one profile against vc.model_unit_price. The ledger is
// USD per 1K tokens. These values are derived on read and are not inputs.
const (
	LedgerPriceActive              = "ACTIVE"
	LedgerPriceMissing             = "MISSING"
	LedgerPriceUnsupportedCurrency = "UNSUPPORTED_CURRENCY"
)

// ProviderModel is one profile: a configured use of a remote model. On input a
// nil Capabilities / ReasoningLevels / GenerationParams / Pricing keeps the
// stored document (new profiles start empty). Priority is global across
// providers; smaller values are attempted first by the legacy route chain.
type ProviderModel struct {
	ProfileKey          string
	ModelID             string
	DisplayName         string
	ContextWindowTokens *int
	MaxOutputTokens     int
	Priority            int
	State               string
	Capabilities        ModelCapabilities
	ReasoningLevels     []string
	GenerationParams    *GenerationParams
	Pricing             *ModelPricing
	BoundPurposes       []string
	UpdatedAt           time.Time
	LedgerPrice         string
}

// ToolCallVerification is the record written only by the explicit probe.
type ToolCallVerification struct {
	VerifiedAt time.Time
	Protocol   string
}

// ProviderConfig is the secret-free administrator view.
type ProviderConfig struct {
	ProviderID           string
	DisplayName          string
	Protocol             string
	BaseURL              string
	CredentialConfigured bool
	State                string
	Revision             int64
	UpdatedAt            time.Time
	Models               []ProviderModel
}

// SaveProvider is a full provider/model snapshot. A non-empty Credential
// replaces the stored one, ClearCredential removes it, otherwise it is kept.
// ExpectedRevision nil skips the optimistic check.
type SaveProvider struct {
	ProviderID       string
	DisplayName      string
	Protocol         string
	BaseURL          string
	Credential       string
	ClearCredential  bool
	State            string
	ExpectedRevision *int64
	Models           []ProviderModel
}

// ProviderRoute is an internal, per-generation route. Credential is plaintext
// only after the store decrypts the enc2 envelope and is never serialized.
type ProviderRoute struct {
	ProviderID      string
	SupplierName    string
	Protocol        string
	BaseURL         string
	Credential      string
	ModelID         string
	MaxOutputTokens int
	Priority        int
}

// RouteRef identifies one enabled profile in administrator priority order.
// ProfileKey defaults to ModelID for callers that predate profiles.
type RouteRef struct {
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
	ProfileKey string `json:"profileKey,omitempty"`
}

// PurposeBinding pins one purpose to one profile. Status is derived from the
// binding state and the referenced provider/profile.
type PurposeBinding struct {
	Purpose    string
	ProviderID string
	ProfileKey string
	ModelID    string
	State      string
	Status     string
	Revision   int64
	UpdatedAt  time.Time
}

// SavePurposeBinding replaces one binding. Empty ProviderID/ProfileKey leaves
// the purpose pending.
type SavePurposeBinding struct {
	Purpose          string
	ProviderID       string
	ProfileKey       string
	State            string
	ExpectedRevision *int64
}

// ResolvePurpose is the service-channel request. The optional assertions let
// the SillyTavern projection detect that it is stale before it sends.
type ResolvePurpose struct {
	OwnerAccountID   int64
	Purpose          string
	ProviderID       string
	ProfileKey       string
	ProviderRevision *int64
	BindingRevision  *int64
}

// ResolvedPurpose is a READY binding with the decrypted credential. It exists
// only in process memory for one plugin request.
type ResolvedPurpose struct {
	Purpose          string
	BindingRevision  int64
	ProviderID       string
	ProviderName     string
	Protocol         string
	BaseURL          string
	ProviderRevision int64
	Credential       string
	Model            ProviderModel
}

// GetProviderCredential returns a saved credential only to an authenticated
// ADMIN workflow. It is used by explicit model discovery and is never exposed
// through an HTTP response. A credential-less draft yields ErrInvalid.
func (s *Store) GetProviderCredential(ctx context.Context, actingAccountID int64, providerID string) (string, error) {
	providerID = strings.TrimSpace(providerID)
	if !validProviderID(providerID) || s == nil || s.cipher == nil {
		return "", ErrInvalid
	}
	var stored pgtype.Text
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT out_credential_cipher
			  FROM vc.go_admin_get_provider_credential($1,$2)`,
			actingAccountID, providerID).Scan(&stored)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return "", mapStoreErr(err)
	}
	if !stored.Valid {
		return "", ErrInvalid
	}
	plain, err := s.cipher.Decrypt(stored.String)
	if err != nil || !validCredential(plain) {
		return "", errStore
	}
	return plain, nil
}

// modelDocuments holds the jsonb/array columns of one profile row as scanned.
type modelDocuments struct {
	capabilities []byte
	levels       []string
	params       []byte
	pricing      []byte
}

func (d modelDocuments) decode(into *ProviderModel) error {
	caps := ModelCapabilities{}
	if len(d.capabilities) > 0 {
		if err := json.Unmarshal(d.capabilities, &caps); err != nil {
			return err
		}
	}
	into.Capabilities = normalizeCapabilities(caps)
	into.ReasoningLevels = d.levels
	if into.ReasoningLevels == nil {
		into.ReasoningLevels = []string{}
	}
	into.GenerationParams = &GenerationParams{}
	if len(d.params) > 0 {
		if err := json.Unmarshal(d.params, into.GenerationParams); err != nil {
			return err
		}
	}
	into.Pricing = &ModelPricing{}
	if len(d.pricing) > 0 {
		if err := json.Unmarshal(d.pricing, into.Pricing); err != nil {
			return err
		}
	}
	return nil
}

func normalizeCapabilities(in ModelCapabilities) ModelCapabilities {
	out := make(ModelCapabilities, len(CapabilityKeys))
	for _, key := range CapabilityKeys {
		if v, ok := in[key]; ok && v != "" {
			out[key] = v
		} else {
			out[key] = CapabilityUnknown
		}
	}
	return out
}

func (s *Store) ListProviderConfigs(ctx context.Context, actingAccountID int64) ([]ProviderConfig, error) {
	var out []ProviderConfig
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_provider_id, out_display_name, out_protocol, out_base_url,
			       out_credential_configured, out_provider_state, out_provider_revision,
			       out_provider_updated_at, out_profile_key, out_model_id,
			       out_model_display_name, out_context_window_tokens, out_max_output_tokens,
			       out_priority, out_model_state, out_capabilities, out_reasoning_levels,
			       out_generation_params, out_pricing, out_bound_purposes, out_model_updated_at,
			       out_ledger_price
			  FROM vc.go_admin_list_provider_models($1)`, actingAccountID)
		if err != nil {
			return err
		}
		defer rows.Close()
		index := make(map[string]int)
		for rows.Next() {
			var providerID, displayName, protocol, baseURL, state string
			var credentialConfigured bool
			var revision int64
			var providerUpdated time.Time
			var profileKey, modelID, modelDisplay, modelState pgtype.Text
			var contextTokens, maxOutput, priority pgtype.Int4
			var docs modelDocuments
			var bound []string
			var modelUpdated pgtype.Timestamptz
			var ledgerPrice pgtype.Text
			if err := rows.Scan(
				&providerID, &displayName, &protocol, &baseURL,
				&credentialConfigured, &state, &revision, &providerUpdated,
				&profileKey, &modelID, &modelDisplay, &contextTokens, &maxOutput,
				&priority, &modelState, &docs.capabilities, &docs.levels,
				&docs.params, &docs.pricing, &bound, &modelUpdated, &ledgerPrice,
			); err != nil {
				return err
			}
			i, ok := index[providerID]
			if !ok {
				i = len(out)
				index[providerID] = i
				out = append(out, ProviderConfig{
					ProviderID: providerID, DisplayName: displayName,
					Protocol: protocol, BaseURL: baseURL,
					CredentialConfigured: credentialConfigured,
					State:                state, Revision: revision,
					UpdatedAt: providerUpdated.UTC(),
					Models:    []ProviderModel{},
				})
			}
			if !profileKey.Valid {
				continue
			}
			model := ProviderModel{
				ProfileKey: profileKey.String, ModelID: modelID.String,
				DisplayName:     modelDisplay.String,
				MaxOutputTokens: int(maxOutput.Int32), Priority: int(priority.Int32),
				State: modelState.String, BoundPurposes: bound,
			}
			if model.BoundPurposes == nil {
				model.BoundPurposes = []string{}
			}
			if contextTokens.Valid {
				n := int(contextTokens.Int32)
				model.ContextWindowTokens = &n
			}
			if modelUpdated.Valid {
				model.UpdatedAt = modelUpdated.Time.UTC()
			}
			if ledgerPrice.Valid {
				model.LedgerPrice = ledgerPrice.String
			}
			if err := docs.decode(&model); err != nil {
				return errStore
			}
			out[i].Models = append(out[i].Models, model)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if out == nil {
		out = []ProviderConfig{}
	}
	return out, nil
}

func jsonDocument(v any) (*string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	text := string(raw)
	return &text, nil
}

// SaveProviderConfig replaces one provider snapshot atomically and returns the
// provider revision after the save. Plaintext credentials only pass through
// the field cipher; the database never sees them.
func (s *Store) SaveProviderConfig(ctx context.Context, actingAccountID int64, in SaveProvider) (int64, error) {
	in.ProviderID = strings.TrimSpace(in.ProviderID)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	in.BaseURL = strings.TrimSpace(in.BaseURL)
	for i := range in.Models {
		in.Models[i].ModelID = strings.TrimSpace(in.Models[i].ModelID)
		in.Models[i].ProfileKey = strings.TrimSpace(in.Models[i].ProfileKey)
		if in.Models[i].ProfileKey == "" {
			in.Models[i].ProfileKey = in.Models[i].ModelID
		}
		in.Models[i].DisplayName = strings.TrimSpace(in.Models[i].DisplayName)
	}
	if !validProviderInput(in) {
		return 0, ErrInvalid
	}

	action := credentialKeep
	var cipherText *string
	switch {
	case in.Credential != "":
		if s == nil || s.cipher == nil || !validCredential(in.Credential) {
			return 0, ErrInvalid
		}
		value, err := s.cipher.Encrypt(in.Credential)
		if err != nil {
			return 0, errStore
		}
		cipherText = &value
		action = credentialSet
	case in.ClearCredential:
		action = credentialClear
	}

	profileKeys := make([]string, 0, len(in.Models))
	for i := range in.Models {
		profileKeys = append(profileKeys, in.Models[i].ProfileKey)
	}
	var revision int64
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		// Keep the provider non-routable while replacing its model snapshot;
		// the optimistic check runs here, the revision bump at the end.
		if err := tx.QueryRow(ctx,
			`SELECT vc.go_admin_upsert_provider($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			actingAccountID, in.ProviderID, in.DisplayName, in.Protocol,
			in.BaseURL, action, cipherText, ProviderDisabled, in.ExpectedRevision, false,
		).Scan(&revision); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`SELECT vc.go_admin_delete_provider_models_except($1,$2,$3)`,
			actingAccountID, in.ProviderID, profileKeys); err != nil {
			return err
		}
		for _, model := range in.Models {
			var capabilities, params, pricing *string
			var err error
			if model.Capabilities != nil {
				if capabilities, err = jsonDocument(normalizeCapabilities(model.Capabilities)); err != nil {
					return ErrInvalid
				}
			}
			if model.GenerationParams != nil {
				if params, err = jsonDocument(model.GenerationParams); err != nil {
					return ErrInvalid
				}
			}
			if model.Pricing != nil {
				if pricing, err = jsonDocument(model.Pricing); err != nil {
					return ErrInvalid
				}
			}
			if _, err := tx.Exec(ctx,
				`SELECT vc.go_admin_upsert_provider_model($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
				actingAccountID, in.ProviderID, model.ProfileKey, model.ModelID, model.DisplayName,
				model.ContextWindowTokens, model.MaxOutputTokens, model.State,
				capabilities, model.ReasoningLevels, params, pricing); err != nil {
				return err
			}
		}
		if err := tx.QueryRow(ctx,
			`SELECT vc.go_admin_upsert_provider($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			actingAccountID, in.ProviderID, in.DisplayName, in.Protocol,
			in.BaseURL, credentialKeep, nil, in.State, nil, true,
		).Scan(&revision); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`SELECT vc.go_admin_normalize_provider_model_priorities($1)`, actingAccountID)
		return err
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return revision, nil
}

// MarkModelToolCallsVerified records a successful synthetic tool-call probe.
// Administrator saves cannot take this path.
func (s *Store) MarkModelToolCallsVerified(ctx context.Context, actingAccountID int64, providerID, profileKey string) (ToolCallVerification, error) {
	providerID = strings.TrimSpace(providerID)
	profileKey = strings.TrimSpace(profileKey)
	if !validProviderID(providerID) || !validProfileKey(profileKey) {
		return ToolCallVerification{}, ErrInvalid
	}
	var out ToolCallVerification
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT out_verified_at, out_protocol
			  FROM vc.go_admin_mark_model_tool_calls_verified($1,$2,$3)`,
			actingAccountID, providerID, profileKey).Scan(&out.VerifiedAt, &out.Protocol)
	})
	if err != nil {
		return ToolCallVerification{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ReorderProviderModels(ctx context.Context, actingAccountID int64, order []RouteRef) error {
	if len(order) > 32 {
		return ErrInvalid
	}
	type routeKey struct {
		ProviderID string `json:"providerId"`
		ProfileKey string `json:"profileKey"`
	}
	keys := make([]routeKey, 0, len(order))
	seen := make(map[routeKey]struct{}, len(order))
	for i := range order {
		key := routeKey{
			ProviderID: strings.TrimSpace(order[i].ProviderID),
			ProfileKey: strings.TrimSpace(order[i].ProfileKey),
		}
		if key.ProfileKey == "" {
			key.ProfileKey = strings.TrimSpace(order[i].ModelID)
		}
		if key.ProviderID == "" || key.ProfileKey == "" {
			return ErrInvalid
		}
		if _, ok := seen[key]; ok {
			return ErrInvalid
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	payload, err := json.Marshal(keys)
	if err != nil {
		return ErrInvalid
	}
	err = s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`SELECT vc.go_admin_reorder_provider_models($1,$2::jsonb)`,
			actingAccountID, string(payload))
		return err
	})
	return mapStoreErr(err)
}

// ResolveProviderRoutes freezes at most the primary and one fallback route for
// a generation. It decrypts credentials only in process memory.
func (s *Store) ResolveProviderRoutes(ctx context.Context) ([]ProviderRoute, error) {
	var out []ProviderRoute
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_provider_id, out_supplier_name, out_protocol, out_base_url,
			       out_credential_cipher, out_model_id, out_max_output_tokens,
			       out_priority
			  FROM vc.go_resolve_model_routes()`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var route ProviderRoute
			var stored string
			if err := rows.Scan(
				&route.ProviderID, &route.SupplierName, &route.Protocol,
				&route.BaseURL, &stored, &route.ModelID,
				&route.MaxOutputTokens, &route.Priority,
			); err != nil {
				return err
			}
			if s.cipher == nil {
				return errStore
			}
			plain, err := s.cipher.Decrypt(stored)
			if err != nil || !validCredential(plain) {
				return errStore
			}
			route.Credential = plain
			out = append(out, route)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if out == nil {
		out = []ProviderRoute{}
	}
	return out, nil
}

// purposeUnavailableReason explains a non-READY binding. A disabled purpose
// stays "disabled" even when the credential is also gone; a configured binding
// with no stored credential is "credential".
func purposeUnavailableReason(purpose, bindingState string, bound bool, providerState string,
	credentialConfigured bool, modelState string, contextWindow *int) string {
	switch {
	case !bound:
		return PurposeReasonPending
	case bindingState != ProviderEnabled:
		return PurposeReasonDisabled
	case !credentialConfigured:
		return PurposeReasonCredential
	case providerState != ProviderEnabled:
		return PurposeReasonProvider
	case modelState != ProviderEnabled:
		return PurposeReasonModel
	case purpose != PurposeEmbedding && contextWindow == nil:
		return PurposeReasonContext
	default:
		return PurposeReasonProvider
	}
}

// bindingStatus derives the purpose status. A disabled binding is reported as
// DISABLED even when its target is unusable; chat purposes also require the
// context window the SillyTavern projection budgets with.
func bindingStatus(purpose, bindingState string, bound bool, providerState string,
	credentialConfigured bool, modelState string, contextWindow *int) string {
	switch {
	case !bound:
		return BindingPending
	case bindingState != ProviderEnabled:
		return BindingDisabled
	case providerState != ProviderEnabled || modelState != ProviderEnabled || !credentialConfigured:
		return BindingUnavailable
	case purpose != PurposeEmbedding && contextWindow == nil:
		return BindingUnavailable
	default:
		return BindingReady
	}
}

func scanBinding(row pgx.Row) (PurposeBinding, error) {
	var b PurposeBinding
	var providerID, profileKey, modelID, providerState, modelState pgtype.Text
	var credentialConfigured pgtype.Bool
	var contextTokens pgtype.Int4
	var updated time.Time
	if err := row.Scan(
		&b.Purpose, &providerID, &profileKey, &modelID, &b.State, &b.Revision,
		&updated, &providerState, &credentialConfigured, &modelState, &contextTokens,
	); err != nil {
		return b, err
	}
	b.ProviderID, b.ProfileKey, b.ModelID = providerID.String, profileKey.String, modelID.String
	b.UpdatedAt = updated.UTC()
	var contextWindow *int
	if contextTokens.Valid {
		n := int(contextTokens.Int32)
		contextWindow = &n
	}
	b.Status = bindingStatus(b.Purpose, b.State, providerID.Valid, providerState.String,
		credentialConfigured.Bool, modelState.String, contextWindow)
	return b, nil
}

const bindingColumns = `out_purpose, out_provider_id, out_profile_key, out_model_id, out_state,
       out_revision, out_updated_at, out_provider_state, out_credential_configured,
       out_model_state, out_context_window_tokens`

func (s *Store) ListPurposeBindings(ctx context.Context, actingAccountID int64) ([]PurposeBinding, error) {
	var out []PurposeBinding
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+bindingColumns+` FROM vc.go_admin_list_purpose_bindings($1)`, actingAccountID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			b, err := scanBinding(rows)
			if err != nil {
				return err
			}
			out = append(out, b)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if out == nil {
		out = []PurposeBinding{}
	}
	return out, nil
}

func (s *Store) SavePurposeBinding(ctx context.Context, actingAccountID int64, in SavePurposeBinding) (PurposeBinding, error) {
	in.Purpose = strings.TrimSpace(in.Purpose)
	in.ProviderID = strings.TrimSpace(in.ProviderID)
	in.ProfileKey = strings.TrimSpace(in.ProfileKey)
	if !validPurpose(in.Purpose) ||
		(in.State != ProviderEnabled && in.State != ProviderDisabled) ||
		(in.ProviderID == "") != (in.ProfileKey == "") ||
		(in.ProviderID != "" && (!validProviderID(in.ProviderID) || !validProfileKey(in.ProfileKey))) ||
		(in.Purpose == PurposeEmbedding && in.ProviderID != "") ||
		(in.ExpectedRevision != nil && *in.ExpectedRevision < 0) {
		return PurposeBinding{}, ErrInvalid
	}
	var providerID, profileKey *string
	if in.ProviderID != "" {
		providerID, profileKey = &in.ProviderID, &in.ProfileKey
	}
	var out PurposeBinding
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		b, err := scanBinding(tx.QueryRow(ctx,
			`SELECT `+bindingColumns+` FROM vc.go_admin_upsert_purpose_binding($1,$2,$3,$4,$5,$6)`,
			actingAccountID, in.Purpose, providerID, profileKey, in.State, in.ExpectedRevision))
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		out = b
		return err
	})
	if err != nil {
		return PurposeBinding{}, mapStoreErr(err)
	}
	return out, nil
}

// ResolvePurpose serves the SillyTavern server plugin: the binding must be
// READY and any assertion the caller makes about the profile or revisions
// must match the live rows, otherwise the projection is stale.
func (s *Store) ResolvePurpose(ctx context.Context, in ResolvePurpose) (ResolvedPurpose, error) {
	in.Purpose = strings.TrimSpace(in.Purpose)
	in.ProviderID = strings.TrimSpace(in.ProviderID)
	in.ProfileKey = strings.TrimSpace(in.ProfileKey)
	if !validPurpose(in.Purpose) || in.OwnerAccountID <= 0 || s == nil || s.cipher == nil {
		return ResolvedPurpose{}, ErrInvalid
	}
	var out ResolvedPurpose
	var stored pgtype.Text
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var bindingState, providerID, providerName, protocol, baseURL, providerState string
		var profileKey, modelID, modelDisplay, modelState pgtype.Text
		var providerIDText, providerNameText, protocolText, baseURLText, providerStateText pgtype.Text
		var providerRevision pgtype.Int8
		var contextTokens, maxOutput pgtype.Int4
		var docs modelDocuments
		err := tx.QueryRow(ctx, `
			SELECT out_purpose, out_binding_state, out_binding_revision, out_provider_id,
			       out_provider_display_name, out_protocol, out_base_url, out_credential_cipher,
			       out_provider_state, out_provider_revision, out_profile_key, out_model_id,
			       out_model_display_name, out_context_window_tokens, out_max_output_tokens,
			       out_model_state, out_capabilities, out_reasoning_levels,
			       out_generation_params, out_pricing
			  FROM vc.go_service_resolve_purpose($1,$2)`, in.OwnerAccountID, in.Purpose,
		).Scan(
			&out.Purpose, &bindingState, &out.BindingRevision, &providerIDText,
			&providerNameText, &protocolText, &baseURLText, &stored,
			&providerStateText, &providerRevision, &profileKey, &modelID,
			&modelDisplay, &contextTokens, &maxOutput, &modelState,
			&docs.capabilities, &docs.levels, &docs.params, &docs.pricing,
		)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		providerID, providerName, protocol = providerIDText.String, providerNameText.String, protocolText.String
		baseURL, providerState = baseURLText.String, providerStateText.String
		var contextWindow *int
		if contextTokens.Valid {
			n := int(contextTokens.Int32)
			contextWindow = &n
		}
		status := bindingStatus(out.Purpose, bindingState, providerIDText.Valid, providerState,
			stored.Valid, modelState.String, contextWindow)
		if status != BindingReady {
			return &PurposeUnavailableError{Status: status, Reason: purposeUnavailableReason(out.Purpose, bindingState, providerIDText.Valid, providerState, stored.Valid, modelState.String, contextWindow)}
		}
		if (in.ProviderID != "" && in.ProviderID != providerID) ||
			(in.ProfileKey != "" && in.ProfileKey != profileKey.String) ||
			(in.ProviderRevision != nil && *in.ProviderRevision != providerRevision.Int64) ||
			(in.BindingRevision != nil && *in.BindingRevision != out.BindingRevision) {
			return &ResolveConflictError{
				ProviderID: providerID, ProfileKey: profileKey.String,
				ProviderRevision: providerRevision.Int64, BindingRevision: out.BindingRevision,
			}
		}
		out.ProviderID, out.ProviderName, out.Protocol, out.BaseURL = providerID, providerName, protocol, baseURL
		out.ProviderRevision = providerRevision.Int64
		out.Model = ProviderModel{
			ProfileKey: profileKey.String, ModelID: modelID.String, DisplayName: modelDisplay.String,
			ContextWindowTokens: contextWindow, MaxOutputTokens: int(maxOutput.Int32),
			State: modelState.String, BoundPurposes: []string{},
		}
		if err := docs.decode(&out.Model); err != nil {
			return errStore
		}
		return nil
	})
	if err != nil {
		return ResolvedPurpose{}, mapStoreErr(err)
	}
	plain, err := s.cipher.Decrypt(stored.String)
	if err != nil || !validCredential(plain) {
		return ResolvedPurpose{}, errStore
	}
	out.Credential = plain
	return out, nil
}

func validProviderInput(in SaveProvider) bool {
	if !validProviderID(in.ProviderID) {
		return false
	}
	if utf8.RuneCountInString(in.DisplayName) < 1 || utf8.RuneCountInString(in.DisplayName) > 80 ||
		len(in.BaseURL) < 1 || len(in.BaseURL) > 2048 ||
		(in.Protocol != ProtocolOpenAIChat && in.Protocol != ProtocolOpenAIResponses && in.Protocol != ProtocolAnthropic) ||
		(in.State != ProviderEnabled && in.State != ProviderDisabled) ||
		len(in.Models) < 1 || len(in.Models) > 32 ||
		(in.Credential != "" && in.ClearCredential) ||
		(in.ClearCredential && in.State == ProviderEnabled) ||
		(in.ExpectedRevision != nil && *in.ExpectedRevision < 0) {
		return false
	}
	enabled := 0
	seen := make(map[string]struct{}, len(in.Models))
	for _, model := range in.Models {
		if !validModel(model) {
			return false
		}
		if _, ok := seen[model.ProfileKey]; ok {
			return false
		}
		seen[model.ProfileKey] = struct{}{}
		if model.State == ProviderEnabled {
			enabled++
		}
	}
	return in.State != ProviderEnabled || enabled > 0
}

func validProviderID(value string) bool {
	if len(value) < 1 || len(value) > 64 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-') {
			return false
		}
	}
	return true
}

func validProfileKey(value string) bool {
	if utf8.RuneCountInString(value) < 1 || len(value) > 200 {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func validPurpose(value string) bool {
	for _, p := range Purposes {
		if p == value {
			return true
		}
	}
	return false
}

func validModel(model ProviderModel) bool {
	if !validProfileKey(model.ProfileKey) || !validProfileKey(model.ModelID) ||
		utf8.RuneCountInString(model.DisplayName) < 1 || utf8.RuneCountInString(model.DisplayName) > 100 ||
		model.MaxOutputTokens < 1 || model.MaxOutputTokens > 262144 ||
		(model.State != ProviderEnabled && model.State != ProviderDisabled) {
		return false
	}
	if model.ContextWindowTokens != nil &&
		(*model.ContextWindowTokens < 1 || *model.ContextWindowTokens > 2000000) {
		return false
	}
	return validCapabilityInput(model.Capabilities) &&
		validReasoningLevels(model.ReasoningLevels) &&
		validGenerationParams(model.GenerationParams, model.ReasoningLevels) &&
		validPricing(model.Pricing)
}

// validCapabilityInput checks shape and vocabulary. Whether a VERIFIED value
// may be echoed (same profile already verified that field) or is a refused
// upgrade is decided in the database against the stored row.
func validCapabilityInput(caps ModelCapabilities) bool {
	if caps == nil {
		return true
	}
	allowed := make(map[string]struct{}, len(CapabilityKeys))
	for _, key := range CapabilityKeys {
		allowed[key] = struct{}{}
	}
	for key, value := range caps {
		if _, ok := allowed[key]; !ok {
			return false
		}
		switch value {
		case CapabilityUnknown, CapabilityDeclared, CapabilityVerified, CapabilityUnsupported:
		default:
			return false
		}
	}
	return true
}

func validReasoningLevels(levels []string) bool {
	if levels == nil {
		return true
	}
	if len(levels) > 8 {
		return false
	}
	seen := make(map[string]struct{}, len(levels))
	for _, level := range levels {
		if !reasoningLevelPattern.MatchString(level) {
			return false
		}
		if _, ok := seen[level]; ok {
			return false
		}
		seen[level] = struct{}{}
	}
	return true
}

// validGenerationParams checks ranges; membership of reasoningEffort in the
// stored levels is checked here only when the levels travel with the same
// request, otherwise the database compares against the stored list.
func validGenerationParams(params *GenerationParams, levels []string) bool {
	if params == nil {
		return true
	}
	if params.Temperature != nil && (*params.Temperature < 0 || *params.Temperature > 2) {
		return false
	}
	if params.TopP != nil && (*params.TopP < 0 || *params.TopP > 1) {
		return false
	}
	if params.ReasoningEffort != nil {
		if !reasoningLevelPattern.MatchString(*params.ReasoningEffort) {
			return false
		}
		if levels != nil {
			found := false
			for _, level := range levels {
				if level == *params.ReasoningEffort {
					found = true
				}
			}
			if !found {
				return false
			}
		}
	}
	return true
}

func validPricing(pricing *ModelPricing) bool {
	if pricing == nil {
		return true
	}
	if pricing.Currency != nil && !currencyPattern.MatchString(*pricing.Currency) {
		return false
	}
	if pricing.InputPerMillionTokens != nil && *pricing.InputPerMillionTokens < 0 {
		return false
	}
	if pricing.OutputPerMillionTokens != nil && *pricing.OutputPerMillionTokens < 0 {
		return false
	}
	if pricing.VerifiedOn != nil {
		if _, err := time.Parse("2006-01-02", *pricing.VerifiedOn); err != nil {
			return false
		}
	}
	if (pricing.InputPerMillionTokens != nil || pricing.OutputPerMillionTokens != nil) && pricing.Currency == nil {
		return false
	}
	return true
}

func validCredential(value string) bool {
	if len(value) < 1 || len(value) > 4096 || strings.TrimSpace(value) == "" {
		return false
	}
	for _, r := range value {
		if r > 0xff || unicode.IsControl(r) {
			return false
		}
	}
	return true
}
