package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type exportEnvelope struct {
	ExportedAt        string               `json:"exportedAt"`
	ConversationCount int                  `json:"conversationCount"`
	MessageCount      int                  `json:"messageCount"`
	MemoryCount       int                  `json:"memoryCount"`
	Conversations     []exportConversation `json:"conversations"`
	Memories          []exportMemory       `json:"memories"`
}

type exportConversation struct {
	ConversationID int64           `json:"conversationId"`
	RelationshipID int64           `json:"relationshipId"`
	Incognito      bool            `json:"incognito"`
	Messages       []exportMessage `json:"messages"`
}

type exportMessage struct {
	MessageID int64  `json:"messageId"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
	NoMemory  bool   `json:"noMemory"`
}

type exportMemory struct {
	MemoryID       int64  `json:"memoryId"`
	RelationshipID int64  `json:"relationshipId"`
	Summary        string `json:"summary"`
	Status         string `json:"status"`
}

func (l *Loop) handleExport(ctx context.Context, c postgres.JobClaim) error {
	return l.handleExportWithKey(ctx, c, newExportObjectKey)
}

func (l *Loop) handleExportWithKey(
	ctx context.Context,
	c postgres.JobClaim,
	keyFor func(owner, exportID int64) (string, error),
) error {
	exp, err := l.store.GetExport(ctx, c.OwnerID, c.RefID)
	if err != nil {
		_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_MISSING")
		return err
	}
	if exp.Status != "PENDING" {
		_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "DONE", "")
		return nil
	}
	payload, err := l.buildExport(ctx, c.OwnerID)
	if err != nil {
		_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_BUILD")
		return err
	}
	expires := time.Now().UTC().Add(24 * time.Hour)
	if l.blobs != nil {
		key, err := keyFor(c.OwnerID, c.RefID)
		if err != nil {
			_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_KEY")
			return err
		}
		if _, err := l.store.RecordExportUploadIntent(ctx, c.OwnerID, c.RefID, key, int(l.policy.ExportLease.Seconds())); err != nil {
			_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_INTENT")
			return err
		}
		if err := l.blobs.Put(ctx, key, payload); err != nil {
			_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_PUT")
			return err
		}
		if err := l.store.CompleteExportObject(ctx, c.OwnerID, c.RefID, key, int64(len(payload)), expires); err != nil {
			_ = l.blobs.Delete(ctx, key)
			_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_SEAL")
			return err
		}
	} else if err := l.store.CompleteExport(ctx, c.OwnerID, c.RefID, string(payload), expires); err != nil {
		_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_SEAL")
		return err
	}
	return l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "DONE", "")
}

func newExportObjectKey(owner, exportID int64) (string, error) {
	return newExportObjectKeyWithRead(owner, exportID, rand.Read)
}

func newExportObjectKeyWithRead(
	owner, exportID int64,
	read func([]byte) (int, error),
) (string, error) {
	var attempt [8]byte
	if _, err := read(attempt[:]); err != nil {
		return "", fmt.Errorf("generate export object key: %w", err)
	}
	return fmt.Sprintf("exports/%d/%d-%s.json", owner, exportID, hex.EncodeToString(attempt[:])), nil
}

func (l *Loop) buildExport(ctx context.Context, owner int64) ([]byte, error) {
	convs, err := l.store.ListConversations(ctx, owner, nil, nil, nil)
	if err != nil {
		return nil, err
	}
	env := exportEnvelope{ExportedAt: time.Now().UTC().Format(time.RFC3339)}
	for _, conv := range convs {
		row := exportConversation{
			ConversationID: conv.ID,
			RelationshipID: conv.RelationshipID,
			Incognito:      conv.Incognito,
			Messages:       []exportMessage{},
		}
		msgs, err := l.store.ListMessages(ctx, owner, conv.ID, nil, nil)
		if err != nil {
			return nil, err
		}
		for _, m := range msgs {
			row.Messages = append(row.Messages, exportMessage{
				MessageID: m.ID,
				Role:      m.Role,
				Content:   m.Content,
				CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339Nano),
				NoMemory:  m.NoMemory,
			})
			env.MessageCount++
		}
		env.Conversations = append(env.Conversations, row)
		env.ConversationCount++
	}
	rels, err := l.store.ListRelationships(ctx, owner)
	if err != nil {
		return nil, err
	}
	for _, rel := range rels {
		mems, err := l.store.ListMemories(ctx, owner, rel.ID, false)
		if err != nil {
			return nil, err
		}
		for _, mem := range mems {
			env.Memories = append(env.Memories, exportMemory{
				MemoryID: mem.ID, RelationshipID: rel.ID, Summary: mem.Summary, Status: mem.Status,
			})
			env.MemoryCount++
		}
	}
	if env.Conversations == nil {
		env.Conversations = []exportConversation{}
	}
	if env.Memories == nil {
		env.Memories = []exportMemory{}
	}
	return json.Marshal(env)
}
