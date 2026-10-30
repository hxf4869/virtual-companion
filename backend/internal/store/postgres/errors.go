package postgres

import (
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

// ErrNotFound is the owner-scoped miss: foreign and absent are the same.
var ErrNotFound = errors.New("not found")

// ErrInvalid is a catalog or request-shape failure. It never carries SQL.
var ErrInvalid = errors.New("invalid request")

// ErrConflict is a state clash that is safe to disclose (in-flight export).
var ErrConflict = errors.New("conflict")

// ErrToolVerificationStale means the probed protocol, base URL, model id, or
// provider revision no longer matches the row. The capability bits stay as they were.
var ErrToolVerificationStale = errors.New("tool call verification identity changed")

// ErrRateLimited is an admission rejection. HTTP maps it to 429.
var ErrRateLimited = errors.New("rate limited")

// ErrAuthChallengeUnavailable is an unknown, expired, consumed or
// attempt-exhausted login challenge. HTTP maps it to 404 AUTH_CHALLENGE_UNAVAILABLE.
var ErrAuthChallengeUnavailable = errors.New("auth challenge unavailable")

// errStore is the opaque persistence failure. Callers must not wrap it
// with SQL, ids, or body text.
var errStore = errors.New("store operation failed")

// ErrServiceOwnerRejected is a service-channel request naming an owner
// account that is not ACTIVE.
var ErrServiceOwnerRejected = errors.New("service owner rejected")

// RevisionConflictError is an optimistic-concurrency miss on a provider or a
// purpose binding. Current is the revision the caller has to re-read.
type RevisionConflictError struct{ Current int64 }

func (e *RevisionConflictError) Error() string { return "revision conflict" }

// ProfileInUseError is a snapshot that would drop a profile a purpose still
// pins; the binding must move first.
type ProfileInUseError struct{ Purposes []string }

func (e *ProfileInUseError) Error() string { return "model profile in use" }

// Purpose-unavailable reasons are stable, body-free classes. Status stays the
// binding status callers already branch on; Reason says why it is not READY.
const (
	PurposeReasonPending    = "pending"
	PurposeReasonDisabled   = "disabled"
	PurposeReasonCredential = "credential"
	PurposeReasonProvider   = "provider"
	PurposeReasonModel      = "model"
	PurposeReasonContext    = "context"
)

// PurposeUnavailableError is a service resolution against a binding that is
// not READY; Status carries the derived binding status.
type PurposeUnavailableError struct {
	Status string
	Reason string
}

func (e *PurposeUnavailableError) Error() string { return "purpose not ready" }

// ResolveConflictError is a stale service-channel assertion; the fields are
// the live values the projection must adopt.
type ResolveConflictError struct {
	ProviderID       string
	ProfileKey       string
	ProviderRevision int64
	BindingRevision  int64
}

func (e *ResolveConflictError) Error() string { return "resolve conflict" }

func typedStoreErr(err error) bool {
	var revision *RevisionConflictError
	var inUse *ProfileInUseError
	var unavailable *PurposeUnavailableError
	var resolve *ResolveConflictError
	return errors.As(err, &revision) || errors.As(err, &inUse) ||
		errors.As(err, &unavailable) || errors.As(err, &resolve)
}

func mapStoreErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalid) ||
		errors.Is(err, ErrConflict) || errors.Is(err, ErrRateLimited) ||
		errors.Is(err, ErrAuthChallengeUnavailable) ||
		errors.Is(err, ErrOwnerContextRejected) || errors.Is(err, turn.ErrOutboundDenied) ||
		errors.Is(err, ErrServiceOwnerRejected) || typedStoreErr(err) ||
		errors.Is(err, errStore) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503": // foreign_key_violation
			return ErrNotFound
		case "23514", "23502", "22001", "22P02":
			return ErrInvalid
		case "P0001":
			return mapRaise(pgErr.Message)
		default:
			return errStore
		}
	}
	return errStore
}

func mapRaise(msg string) error {
	switch {
	case strings.Contains(msg, "model usage unit price is unknown"):
		return &ModelUsageError{Reason: ModelUsageNoPrice}
	case strings.Contains(msg, "model usage limits are not configured"),
		strings.Contains(msg, "model usage ceiling is too small"),
		strings.Contains(msg, "model cost limits are not configured"),
		strings.Contains(msg, "model cost reservation ceiling is too small"):
		return &ModelUsageError{Reason: ModelUsageNoBudget}
	case strings.Contains(msg, "tool call verification identity changed"):
		return ErrToolVerificationStale
	case strings.Contains(msg, "model usage monthly cap exceeded"):
		return &ModelUsageError{Reason: ModelUsageOverLimit}
	case strings.Contains(msg, "model usage reservation is not reusable"):
		return &ModelUsageError{Reason: ModelUsageAttemptReused}
	case strings.Contains(msg, "model usage purpose is not reservable"):
		return ErrInvalid
	case strings.Contains(msg, "revision conflict (current "):
		return &RevisionConflictError{Current: raisedInt(msg, "revision conflict (current ")}
	case strings.Contains(msg, "profile in use: "):
		return &ProfileInUseError{Purposes: strings.Split(raisedTail(msg, "profile in use: "), ",")}
	case strings.HasPrefix(strings.TrimSpace(msg), "profile "):
		return profileSQLError(msg)
	case strings.Contains(msg, "owner is not an active account"):
		return ErrServiceOwnerRejected
	case strings.Contains(msg, "go_admin_purpose: profile not found"):
		return ErrInvalid
	case strings.Contains(msg, "owner deletion is in progress"):
		return ErrNotFound
	case strings.Contains(msg, "deletion is in progress"):
		return ErrNotFound
	case strings.Contains(msg, "already in flight"):
		return ErrConflict
	case strings.Contains(msg, "not found"):
		return ErrNotFound
	case strings.Contains(msg, "idempotency_key is invalid"),
		strings.Contains(msg, "chat_identity is invalid"):
		return ErrInvalid
	case strings.Contains(msg, "outstanding generations exceeded"):
		return ErrRateLimited
	case strings.Contains(msg, "monthly cost hard cap"):
		return ErrRateLimited
	case strings.Contains(msg, "outbound is not currently authorized"):
		return turn.ErrOutboundDenied
	case strings.Contains(msg, "provider is not currently admitted"):
		return turn.ErrOutboundDenied
	case strings.Contains(msg, "no live claim"):
		return ErrConflict
	case strings.Contains(msg, "already terminal"):
		return ErrConflict
	case strings.Contains(msg, "not cancellable"):
		return ErrInvalid
	case strings.Contains(msg, "cancel requested"):
		return ErrConflict
	case strings.Contains(msg, "user content is required"):
		return ErrInvalid
	case strings.Contains(msg, "go_admin_provider"):
		return ErrInvalid
	case strings.Contains(msg, "go_admin_purpose"):
		return ErrInvalid
	default:
		return errStore
	}
}

// profileSQLError maps go_record_memorycore_profile exceptions. Shared
// "memorycore *" messages stay on their existing callers.
func profileSQLError(msg string) error {
	switch {
	case strings.Contains(msg, "fingerprint"):
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_FINGERPRINT")
	case strings.Contains(msg, "scene record"):
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_SCENE_RECORD")
	case strings.Contains(msg, "scenes"):
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_SCENES")
	case strings.Contains(msg, "claim"):
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_CLAIM")
	case strings.Contains(msg, "source"):
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_SOURCE")
	case strings.Contains(msg, "record set"):
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_RECORDS")
	case strings.Contains(msg, "operation"):
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_OPERATION")
	default:
		return memoryengine.ClosedError("MEMORYCORE_PROFILE_INVALID")
	}
}

// raisedTail returns the text after marker in a RAISE message, trimmed.
func raisedTail(msg, marker string) string {
	return strings.TrimSpace(msg[strings.Index(msg, marker)+len(marker):])
}

// raisedInt parses the integer that follows marker up to the next ')'.
func raisedInt(msg, marker string) int64 {
	tail := raisedTail(msg, marker)
	if end := strings.IndexByte(tail, ')'); end >= 0 {
		tail = tail[:end]
	}
	n, err := strconv.ParseInt(strings.TrimSpace(tail), 10, 64)
	if err != nil {
		return 0
	}
	return n
}
