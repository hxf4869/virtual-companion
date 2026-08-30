package turn

import "github.com/hxf4869/virtual-companion/internal/companion"

// DataCategory is a catalog egress class. Static product policy has no
// category and is never consent-filtered.
type DataCategory string

const (
	CategoryMessage DataCategory = "MESSAGE_TEXT"
	CategoryMemory  DataCategory = "MEMORY_SNIPPET"
	CategoryAccount DataCategory = "ACCOUNT_METADATA"
	CategorySafety  DataCategory = "SAFETY_SIGNAL"
)

// HistoryMessage is one prior conversation turn already decrypted by the
// caller. G5 does not load it from PostgreSQL.
type HistoryMessage struct {
	Role    companion.Role
	Content string
}

// MemoryCandidate is a read-only assembly input. G5 never writes memory.
type MemoryCandidate struct {
	SourceID  string
	Summary   string
	Relevance int
	Confirmed bool
}

// Summary is the latest valid conversation summary, if any.
type Summary struct {
	Text  string
	Valid bool
}

// ContextSeed holds the facts this turn may use. Database entities are not
// passed through to the provider.
type ContextSeed struct {
	TurnID              string
	CurrentUserMessage  string
	ConversationMode    string
	UserPersona         UserPersona
	Summary             Summary
	RecentMessages      []HistoryMessage
	EligibleMemories    []MemoryCandidate
	Incognito           bool
	NoMemory            bool
	AllowedCategories   []DataCategory
	ConfigVersion       string
	PromptVersion       string
	StaticPersonaPolicy string
}

func (s ContextSeed) allows(cat DataCategory) bool {
	for _, c := range s.AllowedCategories {
		if c == cat {
			return true
		}
	}
	return false
}

func (s ContextSeed) promptVersion() string {
	if s.PromptVersion != "" {
		return s.PromptVersion
	}
	return PromptVersion
}

func (s ContextSeed) staticPolicy() string {
	if s.StaticPersonaPolicy != "" {
		return s.StaticPersonaPolicy
	}
	return StaticPolicy
}
