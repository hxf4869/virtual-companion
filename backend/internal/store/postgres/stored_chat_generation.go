package postgres

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type ChatGenerationRegistrationRequest struct {
	OwnerAccountID   string `json:"ownerAccountId"`
	RequestID        string `json:"requestId"`
	AuthorityEpoch   int64  `json:"authorityEpoch,string"`
	RunID            string `json:"generationRunId"`
	Revision         int64  `json:"chatRevision,string"`
	InputMessageID   string `json:"inputMessageId"`
	InputCandidateID string `json:"inputCandidateId"`
}
type ChatGenerationRegistration struct {
	RequestID             string    `json:"requestId"`
	ChatID                string    `json:"chatId"`
	RunID                 string    `json:"generationRunId"`
	InputMessageID        string    `json:"inputMessageId"`
	InputCandidateID      string    `json:"inputCandidateId"`
	InputMessageRevision  int64     `json:"inputMessageRevision,string"`
	InputSourceRevision   int64     `json:"inputSourceRevision,string"`
	InputSourceGeneration int64     `json:"inputSourceGeneration,string"`
	Revision              int64     `json:"chatRevision,string"`
	MetadataRevision      int64     `json:"metadataRevision,string"`
	OrderRevision         int64     `json:"orderRevision,string"`
	AuthorityEpoch        int64     `json:"authorityEpoch,string"`
	BranchRoot            string    `json:"branchRoot"`
	RegisteredAt          time.Time `json:"registeredAt"`
	ExpiresAt             time.Time `json:"expiresAt"`
}

func (s *Store) RegisterStoredChatGeneration(ctx context.Context, owner int64, chatID string, in ChatGenerationRegistrationRequest) (ChatGenerationRegistration, error) {
	var out ChatGenerationRegistration
	if in.OwnerAccountID != strconv.FormatInt(owner, 10) || in.AuthorityEpoch < 0 || in.Revision < 0 {
		return out, ErrInvalid
	}
	id, err := normalizeChatID(chatID)
	if err != nil {
		return out, err
	}
	for _, field := range []*string{&in.RequestID, &in.RunID, &in.InputMessageID, &in.InputCandidateID} {
		*field, err = normalizeChatID(*field)
		if err != nil {
			return out, err
		}
	}
	resource := "POST /api/v1/service/chats/" + id + "/generation-runs"
	result, err := s.storedChatWrite(ctx, owner, resource, in.RequestID, in.AuthorityEpoch, in, func(ctx context.Context, tx pgx.Tx, _ string, epoch int64) (chatWriteResult, error) {
		chat, err := s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.lock_stored_chat($1,$2,true)`, owner, id), epoch)
		if err != nil {
			return chatWriteResult{}, err
		}
		var reused bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.chat_generation_run WHERE owner_user_id=$1 AND run_id=$2)`, owner, in.RunID).Scan(&reused); err != nil {
			return chatWriteResult{}, err
		}
		if reused {
			return chatWriteResult{}, chatError("CHAT_GENERATION_FENCED")
		}
		input, err := s.loadStoredMessage(ctx, tx, owner, id, in.InputMessageID)
		if errors.Is(err, ErrNotFound) {
			return chatWriteResult{}, chatError("REVISION_CONFLICT")
		}
		if err != nil {
			return chatWriteResult{}, err
		}
		at := candidateIndex(input, in.InputCandidateID)
		if at < 0 || input.SelectedCandidateID != in.InputCandidateID {
			return chatWriteResult{}, chatError("REVISION_CONFLICT")
		}
		candidate := input.Candidates[at]
		out = ChatGenerationRegistration{RequestID: in.RequestID, ChatID: id, RunID: in.RunID, InputMessageID: input.MessageID,
			InputCandidateID: candidate.CandidateID, InputMessageRevision: input.Revision, InputSourceRevision: candidate.SourceRevision,
			InputSourceGeneration: candidate.SourceGeneration, Revision: in.Revision, MetadataRevision: chat.MetadataRevision,
			OrderRevision: chat.OrderRevision, AuthorityEpoch: epoch, BranchRoot: chat.BranchRoot}
		// A baseline plus per-message creation/source-change counters represents
		// the original history prefix. Unrelated later appends are excluded from it.
		fence, err := chatJSON(out)
		if err != nil {
			return chatWriteResult{}, err
		}
		var valid bool
		if err = tx.QueryRow(ctx, `SELECT vc.stored_chat_fence_valid($1,$2,$3)`, owner, id, fence).Scan(&valid); err != nil {
			return chatWriteResult{}, err
		}
		if !valid {
			return chatWriteResult{}, chatError("REVISION_CONFLICT")
		}
		if err = tx.QueryRow(ctx, `SELECT registered_at,expires_at FROM vc.insert_stored_chat_run($1,$2,$3,$4,$5)`, owner, id, in.RunID, in.RequestID, fence).
			Scan(&out.RegisteredAt, &out.ExpiresAt); err != nil {
			return chatWriteResult{}, err
		}
		body, err := chatJSON(out)
		return chatWriteResult{ChatID: id, Revision: chat.Revision, Status: 201, Body: body}, err
	})
	if err != nil {
		return out, err
	}
	err = chatDecode(result.Body, &out)
	return out, err
}

func (s *Store) checkStoredChatGeneration(ctx context.Context, tx pgx.Tx, owner int64, chatID string, generation ChatGenerationCommit) error {
	if generation.State != "settled" && generation.State != "aborted" {
		return chatError("CHAT_INVALID_OPERATION")
	}
	run, err := normalizeChatID(generation.RunID)
	if err != nil {
		return err
	}
	var valid bool
	err = tx.QueryRow(ctx, `SELECT chat_id=$3::uuid AND state='active' AND expires_at>clock_timestamp()
 AND vc.stored_chat_fence_valid($1,$3,fence) FROM vc.chat_generation_run WHERE owner_user_id=$1 AND run_id=$2`, owner, run, chatID).Scan(&valid)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !valid) {
		return chatError("CHAT_GENERATION_FENCED")
	}
	return err
}

func (s *Store) PruneStoredChatRuns(ctx context.Context) error {
	return s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.prune_stored_chat_runs()`)
		return mapStoreErr(err)
	})
}

func normalizeChatGeneration(generation *ChatGenerationCommit) *ChatGenerationCommit {
	if generation == nil {
		return nil
	}
	copy := *generation
	copy.RunID = strings.ToLower(copy.RunID)
	return &copy
}
