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
		storedBytes, err := l.blobs.Put(ctx, key, payload)
		if err != nil {
			_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "EXPORT_PUT")
			return err
		}
		if err := l.store.CompleteExportObject(ctx, c.OwnerID, c.RefID, key, storedBytes, expires); err != nil {
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

// listAllConversations pages the owner's conversations with an explicit page
// size until the store returns a short page. The V130 cursor is the previous
// page's smallest conversation id over the stable id-keyset listing
// (go_list_export_conversations): id never changes, so concurrent activity
// during a long export cannot skip or repeat whole pages the way the
// mutable last_activity_at frontend cursor could. The cursor must advance
// strictly, so a stalled cursor fails the export instead of silently
// truncating the payload.
func (l *Loop) listAllConversations(ctx context.Context, owner int64) ([]postgres.Conversation, error) {
	limit := exportPageSize
	var after *int64
	var all []postgres.Conversation
	for {
		convs, err := l.store.ListExportConversations(ctx, owner, after, &limit)
		if err != nil {
			return nil, err
		}
		if after != nil && len(convs) > 0 && convs[len(convs)-1].ID >= *after {
			return nil, fmt.Errorf("export: conversation cursor did not advance past %d", *after)
		}
		all = append(all, convs...)
		if len(convs) < exportPageSize {
			return all, nil
		}
		next := convs[len(convs)-1].ID
		after = &next
	}
}

// listAllMessages pages one conversation's history the same way; the cursor is
// the previous page's last message id and must advance strictly.
func (l *Loop) listAllMessages(ctx context.Context, owner, conversationID int64) ([]postgres.Message, error) {
	limit := exportPageSize
	var after *int64
	var all []postgres.Message
	for {
		msgs, err := l.store.ListMessages(ctx, owner, conversationID, after, &limit)
		if err != nil {
			return nil, err
		}
		if after != nil && len(msgs) > 0 && msgs[len(msgs)-1].ID <= *after {
			return nil, fmt.Errorf("export: message cursor did not advance past %d in conversation %d", *after, conversationID)
		}
		all = append(all, msgs...)
		if len(msgs) < exportPageSize {
			return all, nil
		}
		next := msgs[len(msgs)-1].ID
		after = &next
	}
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

// exportPageSize is the explicit page size for export listing. The store
// functions clamp p_limit to this cap (vc.list_conversations / vc.list_messages).
const exportPageSize = 100

func (l *Loop) buildExport(ctx context.Context, owner int64) ([]byte, error) {
	env := exportEnvelope{ExportedAt: time.Now().UTC().Format(time.RFC3339)}
	convs, err := l.listAllConversations(ctx, owner)
	if err != nil {
		return nil, err
	}
	for _, conv := range convs {
		row := exportConversation{
			ConversationID: conv.ID,
			RelationshipID: conv.RelationshipID,
			Incognito:      conv.Incognito,
			Messages:       []exportMessage{},
		}
		msgs, err := l.listAllMessages(ctx, owner, conv.ID)
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
