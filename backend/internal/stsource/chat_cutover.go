package stsource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

var (
	ErrChatCutoverConflict               = errors.New("REVISION_CONFLICT")
	ErrChatTransferTimeout               = errors.New("CHAT_TRANSFER_TIMEOUT")
	ErrChatCutoverSchemaUnavailable      = errors.New("SCHEMA_UNAVAILABLE")
	ErrChatCutoverAccessDenied           = errors.New("ACCESS_DENIED")
	ErrChatCutoverAuthenticationRequired = errors.New("AUTHENTICATION_REQUIRED")
	ErrChatCutoverInvalidRequest         = errors.New("INVALID_REQUEST")
)

const chatCutoverTimeout = 150 * time.Second

var chatAuthorityEpoch = regexp.MustCompile(`^[1-9][0-9]*$`)

// ChatCutoverStatus proves drain only when State is DRAINED and ActiveHandlers is zero.
// The operator must first commit FROZEN in Go; these methods never change Go authority.
type ChatCutoverStatus struct {
	OwnerAccountID string `json:"ownerAccountId"`
	RunID          string `json:"runId"`
	AuthorityEpoch string `json:"authorityEpoch"`
	State          string `json:"state"`
	Closed         bool   `json:"closed"`
	Durable        bool   `json:"durable"`
	ActiveHandlers int64  `json:"activeHandlers"`
}

// FreezeChatAdmission durably closes the ST gate. It does not imply drain.
func (c *Client) FreezeChatAdmission(ctx context.Context, owner int64, runID, authorityEpoch string) (ChatCutoverStatus, error) {
	return c.chatCutover(ctx, "freeze", owner, runID, authorityEpoch)
}

// DrainChatHandlers waits for real server handler completion for this exact run/epoch.
func (c *Client) DrainChatHandlers(ctx context.Context, owner int64, runID, authorityEpoch string) (ChatCutoverStatus, error) {
	return c.chatCutover(ctx, "drain", owner, runID, authorityEpoch)
}

// ChatDrainStatus reads the ST gate's in-memory state without closing or reopening it.
func (c *Client) ChatDrainStatus(ctx context.Context, owner int64, runID, authorityEpoch string) (ChatCutoverStatus, error) {
	return c.chatCutover(ctx, "status", owner, runID, authorityEpoch)
}

func (c *Client) chatCutover(ctx context.Context, operation string, owner int64, runID, epoch string) (ChatCutoverStatus, error) {
	var out ChatCutoverStatus
	if c == nil || owner <= 0 || !ValidIdentity(runID) || !chatAuthorityEpoch.MatchString(epoch) {
		return out, ErrChatCutoverInvalidRequest
	}
	id := strconv.FormatInt(owner, 10)
	input := struct {
		Owner string `json:"ownerAccountId"`
		Run   string `json:"runId"`
		Epoch string `json:"authorityEpoch"`
	}{id, runID, epoch}
	raw, _ := json.Marshal(input)
	ctx, cancel := context.WithTimeout(ctx, chatCutoverTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/internal/v1/st/chat-cutover/"+operation, bytes.NewReader(raw))
	if err != nil {
		return out, ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	// Copy only the client policy; share the existing transport and redirect policy.
	// Ordinary source/inbox calls keep their ten-second client budget.
	client := *c.http
	client.Timeout = chatCutoverTimeout
	res, err := client.Do(req)
	if err != nil {
		return out, chatCutoverIOError(ctx, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, (64<<10)+1))
	if err != nil {
		return out, chatCutoverIOError(ctx, err)
	}
	if ctx.Err() != nil {
		return out, chatCutoverIOError(ctx, ctx.Err())
	}
	if len(body) > 64<<10 {
		return out, ErrUnavailable
	}
	if res.StatusCode != http.StatusOK {
		var failure struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(body, &failure) != nil {
			return out, ErrUnavailable
		}
		for _, mapped := range []struct {
			status int
			err    error
		}{
			{400, ErrChatCutoverInvalidRequest}, {401, ErrChatCutoverAuthenticationRequired},
			{403, ErrChatCutoverAccessDenied}, {409, ErrChatCutoverConflict},
			{503, ErrChatTransferTimeout}, {503, ErrChatCutoverSchemaUnavailable},
		} {
			if res.StatusCode == mapped.status && failure.Code == mapped.err.Error() {
				return out, mapped.err
			}
		}
		return out, ErrUnavailable
	}
	// A missing activeHandlers is not evidence that it reached zero.
	var wire struct {
		OwnerAccountID string `json:"ownerAccountId"`
		RunID          string `json:"runId"`
		AuthorityEpoch string `json:"authorityEpoch"`
		State          string `json:"state"`
		Closed         bool   `json:"closed"`
		Durable        bool   `json:"durable"`
		ActiveHandlers *int64 `json:"activeHandlers"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&wire) != nil || decoder.Decode(new(any)) != io.EOF || wire.OwnerAccountID != id || wire.RunID != runID || wire.AuthorityEpoch != epoch || !wire.Closed || !wire.Durable || wire.ActiveHandlers == nil || *wire.ActiveHandlers < 0 {
		return out, ErrUnavailable
	}
	active := *wire.ActiveHandlers
	if (wire.State != "DRAINED" || active != 0) && (wire.State != "CLOSED" || active == 0) || operation == "drain" && wire.State != "DRAINED" {
		return out, ErrUnavailable
	}
	if ctx.Err() != nil {
		return out, chatCutoverIOError(ctx, ctx.Err())
	}
	return ChatCutoverStatus{wire.OwnerAccountID, wire.RunID, wire.AuthorityEpoch, wire.State, wire.Closed, wire.Durable, active}, nil
}

func chatCutoverIOError(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.Canceled) {
		return context.Canceled
	}
	var timeout net.Error
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.As(err, &timeout) && timeout.Timeout() {
		return errors.Join(ErrChatTransferTimeout, context.DeadlineExceeded)
	}
	return ErrUnavailable
}
