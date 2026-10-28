package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// modelUsageStore is the W11-3 metering surface. Handlers bind it by type
// assertion so CompanionStore stays unchanged.
type modelUsageStore interface {
	ReserveModelUsage(context.Context, postgres.ModelUsageReserve) (postgres.ModelUsageHold, error)
	SettleModelUsage(context.Context, int64, int64, int64, int64) (postgres.ModelUsageSettlement, error)
	CancelModelUsage(context.Context, int64, int64, string) (postgres.ModelUsageCancellation, error)
	RecordLocalEmbeddingCall(context.Context, int64) error
	AdminModelUsageSummary(context.Context, int64, time.Time) ([]postgres.ModelUsagePurposeRow, error)
}

type modelUsageReserveJSON struct {
	OwnerAccountID       string `json:"ownerAccountId"`
	Purpose              string `json:"purpose"`
	AttemptID            string `json:"attemptId"`
	ProviderID           string `json:"providerId"`
	ModelID              string `json:"modelId"`
	EstimatedInputTokens int    `json:"estimatedInputTokens"`
	// EstimatedOutputTokens is this request's max output, not an expected length.
	EstimatedOutputTokens int `json:"estimatedOutputTokens"`
}

type modelUsageSettleJSON struct {
	OwnerAccountID string `json:"ownerAccountId"`
	InputTokens    int64  `json:"inputTokens"`
	OutputTokens   int64  `json:"outputTokens"`
}

type modelUsageCancelJSON struct {
	OwnerAccountID string `json:"ownerAccountId"`
	Disposition    string `json:"disposition"`
}

type modelUsageOwnerJSON struct {
	OwnerAccountID string `json:"ownerAccountId"`
}

func (s *Server) modelUsage(w http.ResponseWriter) (modelUsageStore, bool) {
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "service channel not configured")
		return nil, false
	}
	store, ok := s.core.Store.(modelUsageStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "service channel not configured")
		return nil, false
	}
	return store, true
}

func (s *Server) handleReserveModelUsage(w http.ResponseWriter, r *http.Request) {
	if !s.serviceCaller(w, r) {
		return
	}
	var body modelUsageReserveJSON
	if !s.decodeJSON(w, r, &body) {
		return
	}
	owner, ok := parseOwnerAccountID(body.OwnerAccountID)
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.modelUsage(w)
	if !ok {
		return
	}
	out, err := store.ReserveModelUsage(r.Context(), postgres.ModelUsageReserve{
		Owner: owner, Purpose: body.Purpose, AttemptID: body.AttemptID,
		ProviderID: body.ProviderID, ModelID: body.ModelID,
		InputTokens: body.EstimatedInputTokens, OutputTokens: body.EstimatedOutputTokens,
	})
	if err != nil {
		s.writeModelUsageErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{
		"reservationId": strconv.FormatInt(out.ReservationID, 10),
		"purpose":       out.Purpose,
		"status":        out.Status,
		"reservedUsd":   out.ReservedUSD,
		"attemptId":     out.AttemptID,
	})
}

func (s *Server) handleSettleModelUsage(w http.ResponseWriter, r *http.Request) {
	if !s.serviceCaller(w, r) {
		return
	}
	reservationID, ok := parseReservationID(r.PathValue("reservationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body modelUsageSettleJSON
	if !s.decodeJSON(w, r, &body) {
		return
	}
	owner, ok := parseOwnerAccountID(body.OwnerAccountID)
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.modelUsage(w)
	if !ok {
		return
	}
	out, err := store.SettleModelUsage(r.Context(), owner, reservationID, body.InputTokens, body.OutputTokens)
	if err != nil {
		s.writeModelUsageErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{
		"reservationId": strconv.FormatInt(out.ReservationID, 10),
		"purpose":       out.Purpose,
		"status":        out.Status,
		"actualUsd":     out.ActualUSD,
		"inputTokens":   out.InputTokens,
		"outputTokens":  out.OutputTokens,
		"idempotent":    out.Idempotent,
	})
}

func (s *Server) handleCancelModelUsage(w http.ResponseWriter, r *http.Request) {
	if !s.serviceCaller(w, r) {
		return
	}
	reservationID, ok := parseReservationID(r.PathValue("reservationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body modelUsageCancelJSON
	if !s.decodeJSON(w, r, &body) {
		return
	}
	owner, ok := parseOwnerAccountID(body.OwnerAccountID)
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.modelUsage(w)
	if !ok {
		return
	}
	out, err := store.CancelModelUsage(r.Context(), owner, reservationID, body.Disposition)
	if err != nil {
		s.writeModelUsageErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{
		"reservationId": strconv.FormatInt(out.ReservationID, 10),
		"purpose":       out.Purpose,
		"status":        out.Status,
		"reservedUsd":   out.ReservedUSD,
		"actualUsd":     out.ActualUSD,
		"idempotent":    out.Idempotent,
	})
}

func (s *Server) handleRecordLocalEmbedding(w http.ResponseWriter, r *http.Request) {
	if !s.serviceCaller(w, r) {
		return
	}
	var body modelUsageOwnerJSON
	if !s.decodeJSON(w, r, &body) {
		return
	}
	owner, ok := parseOwnerAccountID(body.OwnerAccountID)
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.modelUsage(w)
	if !ok {
		return
	}
	if err := store.RecordLocalEmbeddingCall(r.Context(), owner); err != nil {
		s.writeModelUsageErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"recorded": true, "billing": "NONE"})
}

func (s *Server) handleAdminModelUsage(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	if p.Role != "ADMIN" {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "access denied")
		return
	}
	days := 14
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		if n < 1 {
			n = 1
		}
		if n > 90 {
			n = 90
		}
		days = n
	}
	store, ok := s.modelUsage(w)
	if !ok {
		return
	}
	rows, err := store.AdminModelUsageSummary(r.Context(), p.AccountID, time.Now().UTC().AddDate(0, 0, -days))
	if err != nil {
		s.writeModelUsageErr(w, err)
		return
	}
	purposes := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		purposes = append(purposes, map[string]any{
			"purpose":      row.Purpose,
			"calls":        row.Calls,
			"actualUsd":    row.ActualUSD,
			"estimatedUsd": row.EstimatedUSD,
			"unsettledUsd": row.UnsettledUSD,
			"inputTokens":  row.InputTokens,
			"outputTokens": row.OutputTokens,
		})
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"purposes": purposes})
}

func (s *Server) writeModelUsageErr(w http.ResponseWriter, err error) {
	var usage *postgres.ModelUsageError
	switch {
	case errors.As(err, &usage):
		switch usage.Reason {
		case postgres.ModelUsageNoPrice, postgres.ModelUsageNoBudget:
			s.writeAPIErrorDetails(w, http.StatusConflict, "MODEL_NO_ELIGIBLE_DEPLOYMENT", "model usage refused",
				map[string]any{"reason": usage.Reason})
		case postgres.ModelUsageOverLimit:
			w.Header().Set("Retry-After", "2")
			s.writeAPIErrorDetails(w, http.StatusTooManyRequests, "RATE_LIMITED", "model usage refused",
				map[string]any{"reason": usage.Reason})
		case postgres.ModelUsageAttemptReused:
			s.writeAPIErrorDetails(w, http.StatusConflict, "INVALID_REQUEST", "model usage refused",
				map[string]any{"reason": usage.Reason})
		default:
			s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		}
	case errors.Is(err, postgres.ErrServiceOwnerRejected):
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "owner account rejected")
	case errors.Is(err, postgres.ErrNotFound):
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
	case errors.Is(err, postgres.ErrInvalid):
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	default:
		s.writeStoreErr(w, err)
	}
}

func parseOwnerAccountID(raw string) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	return id, err == nil && id > 0
}

func parseReservationID(raw string) (int64, bool) {
	return parseOwnerAccountID(raw)
}
