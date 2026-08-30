package turn

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

// Store is the durable Turn/Attempt boundary. The only production
// implementation will be PostgreSQL (G10). G5 uses an in-memory fake in tests.
type Store interface {
	LoadSeed(ctx context.Context, turnID string) (ContextSeed, error)
	PrepareAttempt(ctx context.Context, cmd PrepareAttempt) (PreparedAttempt, error)
	RecordAttemptOutcome(ctx context.Context, outcome companion.AttemptOutcome) error
	FinalizeGeneration(ctx context.Context, cmd FinalizeCommand) error
	TerminalizeGeneration(ctx context.Context, cmd TerminalCommand) error
}

// PrepareAttempt freezes budget and intent. It does not call the provider.
type PrepareAttempt struct {
	TurnID          string
	Budget          companion.TurnBudget
	Categories      []DataCategory
	PromptVersion   string
	PersonaVersion  string
	ConfigVersion   string
	EstimatedTokens int
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
	TurnID    string
	AttemptID string
	Text      string
}

// TerminalCommand records a non-completed Turn. It must not persist body.
type TerminalCommand struct {
	TurnID    string
	AttemptID string
	Phase     companion.Phase
	Reason    string
}
