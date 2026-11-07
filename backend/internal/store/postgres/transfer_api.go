package postgres

import (
	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"time"
)

// Transfer inputs contain only authenticated scope and bounded staging references.
// Owner is always a separate argument supplied by the authenticated caller.
type NativeChatScope struct {
	Kind         string  `json:"kind"`
	CharacterRef *string `json:"characterRef,omitempty"`
	GroupRef     *string `json:"groupRef,omitempty"`
}
type NativeChatUpload struct {
	RequestID      string                `json:"requestId"`
	AuthorityEpoch int64                 `json:"authorityEpoch,string"`
	Scope          NativeChatScope       `json:"scope"`
	Mode           string                `json:"mode,omitempty"`
	FileName       string                `json:"fileName,omitempty"`
	ChatID         string                `json:"chatId"`
	ChatRevision   int64                 `json:"chatRevision,string"`
	ParentChatID   string                `json:"parentChatId,omitempty"`
	ParentRevision int64                 `json:"parentRevision,string,omitempty"`
	Generation     *ChatGenerationCommit `json:"generation,omitempty"`
}
type NativeChatIdentityMapping struct {
	MessageIndex   int                      `json:"messageIndex"`
	InputMessageID *string                  `json:"inputMessageId"`
	MessageID      string                   `json:"messageId"`
	Candidates     []NativeCandidateMapping `json:"candidates"`
}
type NativeCandidateMapping struct {
	CandidateIndex   int     `json:"candidateIndex"`
	InputCandidateID *string `json:"inputCandidateId"`
	CandidateID      string  `json:"candidateId"`
	SourceRevision   int64   `json:"sourceRevision,string"`
	SourceGeneration int64   `json:"sourceGeneration,string"`
}
type NativeChatWriteResult struct {
	RequestID       string                      `json:"requestId"`
	Chat            StoredChatSummary           `json:"chat"`
	IdentityMapping []NativeChatIdentityMapping `json:"identityMapping"`
}
type NativeChatTarget struct {
	FileName     string `json:"fileName"`
	ChatID       string `json:"chatId"`
	ChatRevision int64  `json:"chatRevision,string"`
}
type NativeChatMutation struct {
	RequestID      string           `json:"requestId"`
	AuthorityEpoch int64            `json:"authorityEpoch,string"`
	Scope          NativeChatScope  `json:"scope"`
	Target         NativeChatTarget `json:"target"`
	ToFileName     string           `json:"toFileName,omitempty"`
}
type NativeChatMutationAck struct {
	Scope          NativeChatScope `json:"scope"`
	FileName       string          `json:"fileName"`
	ChatID         string          `json:"chatId"`
	ChatRevision   int64           `json:"chatRevision,string"`
	AuthorityEpoch int64           `json:"authorityEpoch,string"`
	Deleted        bool            `json:"deleted"`
}
type NativeChatMutationResult struct {
	RequestID string                `json:"requestId"`
	Result    NativeChatMutationAck `json:"result"`
}
type ChatImportRequest struct {
	RequestID      string  `json:"requestId"`
	AuthorityEpoch int64   `json:"authorityEpoch,string"`
	Kind           string  `json:"kind"`
	CharacterRef   *string `json:"characterRef,omitempty"`
	GroupRef       *string `json:"groupRef,omitempty"`
	Mode           string  `json:"mode,omitempty"`
}
type ChatImportAccepted struct {
	RequestID string    `json:"requestId"`
	ImportID  string    `json:"importId"`
	Status    string    `json:"status"`
	StatusURL string    `json:"statusUrl"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type ChatImportResult struct {
	ImportID                      string            `json:"importId"`
	Status                        string            `json:"status"`
	ChatID                        *string           `json:"chatId"`
	ValidatedMessages             int64             `json:"validatedMessages"`
	ValidatedCandidates           int64             `json:"validatedCandidates"`
	UnresolvedExtensionReferences int64             `json:"unresolvedExtensionReferences"`
	Issues                        []chatjsonl.Issue `json:"issues"`
	IssuesTruncated               bool              `json:"issuesTruncated"`
	ExpiresAt                     time.Time         `json:"expiresAt"`
	FailureCode                   *string           `json:"failureCode"`
}
type ChatTransferIntent struct {
	ID        string    `json:"id"`
	Prefix    string    `json:"prefix"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type ChatImportWork struct {
	Owner    int64
	ImportID string
}

// ChatMigrationManifest is an operator-only archive. All counters use decimal
// strings on the wire; a manifest by itself never authenticates its owner.
type ChatMigrationManifest struct {
	FormatVersion                 int                 `json:"formatVersion"`
	MigrationRunID                string              `json:"migrationRunId"`
	Direction                     string              `json:"direction"`
	OwnerAccountID                int64               `json:"ownerAccountId,string"`
	FrozenAuthorityEpoch          int64               `json:"frozenAuthorityEpoch,string"`
	Chats                         []ChatMigrationChat `json:"chats"`
	DeletionAndSuppressionRecords []ChatData          `json:"deletionAndSuppressionRecords"`
}
type ChatMigrationChat struct {
	OldIdentity                        string                 `json:"oldIdentity"`
	Kind                               string                 `json:"kind"`
	CharacterRef                       *string                `json:"characterRef"`
	GroupRef                           *string                `json:"groupRef"`
	ConversationID                     *int64                 `json:"conversationId,string"`
	RelationshipID                     *int64                 `json:"relationshipId,string"`
	PrimaryFileName                    string                 `json:"primaryFileName"`
	Aliases                            []string               `json:"aliases"`
	BranchRoot                         string                 `json:"branchRoot"`
	ChatRevision                       int64                  `json:"chatRevision,string"`
	MetadataRevision                   int64                  `json:"metadataRevision,string"`
	OrderRevision                      int64                  `json:"orderRevision,string"`
	SourceFile                         string                 `json:"sourceFile"`
	SourceSHA256                       string                 `json:"sourceFileSha256"`
	SourceBytes                        int64                  `json:"sourceFileByteCount,string"`
	MessageCount                       int64                  `json:"messageCount,string"`
	CandidateCount                     int64                  `json:"candidateCount,string"`
	State                              string                 `json:"state"`
	MessageAndCandidateIdentityRecords []ChatMigrationMessage `json:"messageAndCandidateIdentityRecords"`
	SourceRecords                      []ChatData             `json:"sourceRecords"`
}
type ChatMigrationMessage struct {
	MessageID           string                   `json:"messageId"`
	MessageRevision     int64                    `json:"messageRevision,string"`
	Position            int64                    `json:"position,string"`
	SelectedCandidateID *string                  `json:"selectedCandidateId"`
	Deleted             bool                     `json:"deleted"`
	Candidates          []ChatMigrationCandidate `json:"candidates"`
}
type ChatMigrationCandidate struct {
	CandidateID      string `json:"candidateId"`
	Ordinal          int    `json:"ordinal"`
	SourceRevision   int64  `json:"sourceRevision,string"`
	SourceGeneration int64  `json:"sourceGeneration,string"`
	Settled          bool   `json:"settled"`
	EverSelected     bool   `json:"everSelected"`
	Deleted          bool   `json:"deleted"`
}
type ChatMigrationRun struct {
	RunID       string `json:"runId"`
	Direction   string `json:"direction"`
	FrozenEpoch int64  `json:"frozenAuthorityEpoch,string"`
	Status      string `json:"status"`
}
