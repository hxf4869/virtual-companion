package postgres

import (
	"context"
	"encoding/json"
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
)

// ProviderModel is one administrator-configured route target. Priority is
// global across providers; smaller values are attempted first.
type ProviderModel struct {
	ModelID             string
	DisplayName         string
	ContextWindowTokens *int
	MaxOutputTokens     int
	Priority            int
	State               string
	UpdatedAt           time.Time
}

// ProviderConfig is the secret-free administrator view.
type ProviderConfig struct {
	ProviderID           string
	DisplayName          string
	Protocol             string
	BaseURL              string
	CredentialConfigured bool
	State                string
	UpdatedAt            time.Time
	Models               []ProviderModel
}

// SaveProvider is a full provider/model snapshot. Empty Credential preserves
// the existing encrypted credential; a new provider must supply one.
type SaveProvider struct {
	ProviderID  string
	DisplayName string
	Protocol    string
	BaseURL     string
	Credential  string
	State       string
	Models      []ProviderModel
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

// RouteRef identifies one enabled route in administrator priority order.
type RouteRef struct {
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
}

// GetProviderCredential returns a saved credential only to an authenticated
// ADMIN workflow. It is used by explicit model discovery and is never exposed
// through an HTTP response.
func (s *Store) GetProviderCredential(ctx context.Context, actingAccountID int64, providerID string) (string, error) {
	providerID = strings.TrimSpace(providerID)
	if !validProviderID(providerID) || s == nil || s.cipher == nil {
		return "", ErrInvalid
	}
	var stored string
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
	plain, err := s.cipher.Decrypt(stored)
	if err != nil || !validCredential(plain) {
		return "", errStore
	}
	return plain, nil
}

func (s *Store) ListProviderConfigs(ctx context.Context, actingAccountID int64) ([]ProviderConfig, error) {
	var out []ProviderConfig
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_provider_id, out_display_name, out_protocol, out_base_url,
			       out_credential_configured, out_provider_state,
			       out_provider_updated_at, out_model_id, out_model_display_name,
			       out_context_window_tokens, out_max_output_tokens, out_priority,
			       out_model_state, out_model_updated_at
			  FROM vc.go_admin_list_provider_models($1)`, actingAccountID)
		if err != nil {
			return err
		}
		defer rows.Close()
		index := make(map[string]int)
		for rows.Next() {
			var providerID, displayName, protocol, baseURL, state string
			var credentialConfigured bool
			var providerUpdated time.Time
			var modelID, modelDisplay, modelState pgtype.Text
			var contextTokens, maxOutput, priority pgtype.Int4
			var modelUpdated pgtype.Timestamptz
			if err := rows.Scan(
				&providerID, &displayName, &protocol, &baseURL,
				&credentialConfigured, &state, &providerUpdated,
				&modelID, &modelDisplay, &contextTokens, &maxOutput, &priority,
				&modelState, &modelUpdated,
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
					State:                state, UpdatedAt: providerUpdated.UTC(),
					Models: []ProviderModel{},
				})
			}
			if !modelID.Valid {
				continue
			}
			model := ProviderModel{
				ModelID: modelID.String, DisplayName: modelDisplay.String,
				MaxOutputTokens: int(maxOutput.Int32), Priority: int(priority.Int32),
				State: modelState.String,
			}
			if contextTokens.Valid {
				n := int(contextTokens.Int32)
				model.ContextWindowTokens = &n
			}
			if modelUpdated.Valid {
				model.UpdatedAt = modelUpdated.Time.UTC()
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

func (s *Store) SaveProviderConfig(ctx context.Context, actingAccountID int64, in SaveProvider) error {
	in.ProviderID = strings.TrimSpace(in.ProviderID)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	in.BaseURL = strings.TrimSpace(in.BaseURL)
	for i := range in.Models {
		in.Models[i].ModelID = strings.TrimSpace(in.Models[i].ModelID)
		in.Models[i].DisplayName = strings.TrimSpace(in.Models[i].DisplayName)
	}
	if !validProviderInput(in) {
		return ErrInvalid
	}

	var cipherText *string
	if in.Credential != "" {
		if s == nil || s.cipher == nil || !validCredential(in.Credential) {
			return ErrInvalid
		}
		value, err := s.cipher.Encrypt(in.Credential)
		if err != nil {
			return errStore
		}
		cipherText = &value
	}

	modelIDs := make([]string, 0, len(in.Models))
	for i := range in.Models {
		modelIDs = append(modelIDs, in.Models[i].ModelID)
	}
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		// Keep the provider non-routable while replacing its model snapshot.
		if _, err := tx.Exec(ctx,
			`SELECT vc.go_admin_upsert_provider($1,$2,$3,$4,$5,$6,$7)`,
			actingAccountID, in.ProviderID, in.DisplayName, in.Protocol,
			in.BaseURL, cipherText, ProviderDisabled); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`SELECT vc.go_admin_delete_provider_models_except($1,$2,$3)`,
			actingAccountID, in.ProviderID, modelIDs); err != nil {
			return err
		}
		for _, model := range in.Models {
			if _, err := tx.Exec(ctx,
				`SELECT vc.go_admin_upsert_provider_model($1,$2,$3,$4,$5,$6,$7)`,
				actingAccountID, in.ProviderID, model.ModelID, model.DisplayName,
				model.ContextWindowTokens, model.MaxOutputTokens, model.State); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx,
			`SELECT vc.go_admin_upsert_provider($1,$2,$3,$4,$5,$6,$7)`,
			actingAccountID, in.ProviderID, in.DisplayName, in.Protocol,
			in.BaseURL, nil, in.State); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`SELECT vc.go_admin_normalize_provider_model_priorities($1)`, actingAccountID)
		return err
	})
	return mapStoreErr(err)
}

func (s *Store) ReorderProviderModels(ctx context.Context, actingAccountID int64, order []RouteRef) error {
	if len(order) > 32 {
		return ErrInvalid
	}
	seen := make(map[string]struct{}, len(order))
	for i := range order {
		order[i].ProviderID = strings.TrimSpace(order[i].ProviderID)
		order[i].ModelID = strings.TrimSpace(order[i].ModelID)
		key := order[i].ProviderID + "\x00" + order[i].ModelID
		if order[i].ProviderID == "" || order[i].ModelID == "" {
			return ErrInvalid
		}
		if _, ok := seen[key]; ok {
			return ErrInvalid
		}
		seen[key] = struct{}{}
	}
	payload, err := json.Marshal(order)
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

func validProviderInput(in SaveProvider) bool {
	if !validProviderID(in.ProviderID) {
		return false
	}
	if utf8.RuneCountInString(in.DisplayName) < 1 || utf8.RuneCountInString(in.DisplayName) > 80 ||
		len(in.BaseURL) < 1 || len(in.BaseURL) > 2048 ||
		(in.Protocol != ProtocolOpenAIChat && in.Protocol != ProtocolOpenAIResponses && in.Protocol != ProtocolAnthropic) ||
		(in.State != ProviderEnabled && in.State != ProviderDisabled) ||
		len(in.Models) < 1 || len(in.Models) > 32 {
		return false
	}
	enabled := 0
	seen := make(map[string]struct{}, len(in.Models))
	for _, model := range in.Models {
		if !validModel(model) {
			return false
		}
		if _, ok := seen[model.ModelID]; ok {
			return false
		}
		seen[model.ModelID] = struct{}{}
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

func validModel(model ProviderModel) bool {
	if utf8.RuneCountInString(model.ModelID) < 1 || len(model.ModelID) > 200 ||
		utf8.RuneCountInString(model.DisplayName) < 1 || utf8.RuneCountInString(model.DisplayName) > 100 ||
		model.MaxOutputTokens < 1 || model.MaxOutputTokens > 262144 ||
		(model.State != ProviderEnabled && model.State != ProviderDisabled) {
		return false
	}
	for _, r := range model.ModelID {
		if unicode.IsControl(r) {
			return false
		}
	}
	if model.ContextWindowTokens != nil &&
		(*model.ContextWindowTokens < 1 || *model.ContextWindowTokens > 2000000) {
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
