package postgres

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ToolRequest is one model tool call. Owner and relationship are not fields:
// they come from the server-verified session and the chat binding.
type ToolRequest struct {
	ChatIdentity   string
	IdempotencyKey string
	Tool           string
	Arguments      json.RawMessage
	Assistant      bool
	Forbidden      bool
	Purpose        *string
	ModelRevision  *string
	Step           *int
	TimeoutMs      *int
	TokenLimit     *int
}

// ToolExecution is the committed execution fact. A business rejection is a
// row with Status FAILED and a nil error from ExecuteTool.
type ToolExecution struct {
	ID            int64
	Tool          string
	Status        string
	FailureCode   *string
	Result        json.RawMessage
	Purpose       *string
	ModelRevision *string
	Step          *int
	TimeoutMs     *int
	TokenLimit    *int
}

// ExecuteTool commits the execution row, then applies it in a second
// transaction. The same idempotency key returns that same row.
func (s *Store) ExecuteTool(ctx context.Context, owner int64, in ToolRequest) (ToolExecution, error) {
	payload, err := toolPayload(in)
	if err != nil {
		return ToolExecution{}, ErrInvalid
	}
	var id int64
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var status string
		var fresh bool
		return tx.QueryRow(ctx, `SELECT out_id, out_status, out_fresh
			FROM vc.begin_tool_execution($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
			owner, in.ChatIdentity, in.IdempotencyKey, payload,
			nullTrim(in.Purpose), nullTrim(in.ModelRevision), in.Step, in.TimeoutMs, in.TokenLimit,
		).Scan(&id, &status, &fresh)
	})
	if err != nil {
		return ToolExecution{}, mapStoreErr(err)
	}
	var out ToolExecution
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var result []byte
		scanErr := tx.QueryRow(ctx, `SELECT out_id, out_tool, out_status, out_failure_code, out_result,
			out_purpose, out_model_revision, out_step, out_timeout_ms, out_token_limit
			FROM vc.apply_tool_execution($1, $2)`, owner, id).Scan(
			&out.ID, &out.Tool, &out.Status, &out.FailureCode, &result,
			&out.Purpose, &out.ModelRevision, &out.Step, &out.TimeoutMs, &out.TokenLimit,
		)
		if scanErr != nil {
			return scanErr
		}
		if len(result) == 0 {
			result = []byte(`{}`)
		}
		out.Result = result
		return nil
	})
	if err != nil {
		return ToolExecution{}, mapStoreErr(err)
	}
	return out, nil
}

func toolPayload(in ToolRequest) ([]byte, error) {
	args := in.Arguments
	if len(bytesTrim(args)) == 0 {
		args = json.RawMessage(`{}`)
	}
	return json.Marshal(struct {
		Tool      string          `json:"tool"`
		Arguments json.RawMessage `json:"arguments"`
		Assistant bool            `json:"assistant"`
		Forbidden bool            `json:"forbidden"`
	}{
		Tool: in.Tool, Arguments: args, Assistant: in.Assistant, Forbidden: in.Forbidden,
	})
}

func bytesTrim(raw json.RawMessage) []byte {
	return []byte(strings.TrimSpace(string(raw)))
}

func nullTrim(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
