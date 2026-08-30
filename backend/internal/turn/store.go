package turn

import (
	"context"
	"errors"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

// ErrOutboundDenied means the current authorization/provider gate changed
// before the durable attempt intent could be committed. It is safe to expose
// only as the stable blocked disposition; the store never returns gate detail.
var ErrOutboundDenied = errors.New("outbound denied")

// Store is the durable Turn/Attempt boundary. PostgreSQL is the production
// implementation; MemStore is unit tests only. There is no
// AppendAssistantMessage — final text goes through FinalizeGeneration.
type Store interface {
	LoadSeed(ctx context.Context, key TurnKey) (ContextSeed, error)
	PrepareAttempt(ctx context.Context, cmd PrepareAttempt) (PreparedAttempt, error)
	RecordAttemptOutcome(ctx context.Context, outcome companion.AttemptOutcome) error
	FinalizeGeneration(ctx context.Context, cmd FinalizeCommand) error
	TerminalizeGeneration(ctx context.Context, cmd TerminalCommand) error
}

// TurnKey identifies one generation for an already-authenticated owner.
type TurnKey struct {
	OwnerID int64
	TurnID  string
}

// PrepareAttempt freezes budget and intent. It does not call the provider.
type PrepareAttempt struct {
	OwnerID                 int64
	TurnID                  string
	JobID                   int64
	ClaimToken              string
	ClaimFence              string
	Budget                  companion.TurnBudget
	Categories              []DataCategory
	PromptVersion           string
	PersonaVersion          string
	ConfigVersion           string
	ConsentVersion          string
	ProviderContractVersion string
	ProviderID              string
	SupplierName            string
	ModelID                 string
	EstimatedTokens         int
	ReservedCost            int64
	MonthlyCostLimit        int64
}

// PreparedAttempt is the frozen intent returned by PrepareAttempt.
type PreparedAttempt struct {
	AttemptID string
	Budget    companion.TurnBudget
	Fence     int64
}

// FinalizeCommand commits the single final assistant message. The Attempt
// must already be closed; the store must not rewrite outcome or usage.
type FinalizeCommand struct {
	OwnerID    int64
	TurnID     string
	AttemptID  string
	JobID      int64
	ClaimToken string
	ClaimFence string
	Text       string
}

// TerminalCommand records a non-completed Turn. It must not persist body.
type TerminalCommand struct {
	OwnerID    int64
	TurnID     string
	AttemptID  string
	JobID      int64
	ClaimToken string
	ClaimFence string
	Phase      companion.Phase
	Reason     string
}
