package turn

import "github.com/hxf4869/virtual-companion/internal/companion"

// BlockKind names a context block. Transform order is fixed in builder.go.
type BlockKind string

const (
	KindCurrentUser  BlockKind = "current_user"
	KindStaticPolicy BlockKind = "static_policy"
	KindUserPersona  BlockKind = "user_persona"
	KindSummary      BlockKind = "summary"
	KindMemory       BlockKind = "memory"
	KindHistory      BlockKind = "history"
)

// DropReason is a body-free observability code.
type DropReason string

const (
	DropCategoryDenied     DropReason = "CATEGORY_DENIED"
	DropBudget             DropReason = "BUDGET"
	DropUnconfirmed        DropReason = "UNCONFIRMED"
	DropIncognito          DropReason = "INCOGNITO"
	DropNoMemory           DropReason = "NO_MEMORY"
	DropEmpty              DropReason = "EMPTY"
	DropSummaryUnavailable DropReason = "SUMMARY_UNAVAILABLE"
	DropRequiredOverflow   DropReason = "REQUIRED_OVERFLOW"
)

// ContextBlock is one planned fragment. sourceId is internal and never
// copied onto provider messages.
type ContextBlock struct {
	Kind         BlockKind
	Role         companion.Role
	Content      string
	DataCategory DataCategory
	Priority     int
	SourceKind   string
	SourceID     string
	Version      string
	Required     bool
}

// Drop is a deleted block's kind and reason. No content.
type Drop struct {
	Kind   BlockKind
	Reason DropReason
}

// BuildTrace is the only context observability payload.
type BuildTrace struct {
	PromptVersion       string
	PersonaVersion      string
	ConfigVersion       string
	HistoryBlocks       int
	MemoryBlocks        int
	EstimatedTokens     int
	EffectiveCategories []DataCategory
	Drops               []Drop
}

// ContextPlan is the immutable outbound plan for one Attempt.
type ContextPlan struct {
	Blocks   []ContextBlock
	Messages []companion.Message
	Trace    BuildTrace
	Blocked  bool
	Reason   DropReason
}
