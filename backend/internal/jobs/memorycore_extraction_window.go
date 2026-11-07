package jobs

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type engineExtractionReplay struct {
	Messages        []engineExtractionReplayMessage `json:"messages"`
	PrimarySourceID string                          `json:"primarySourceId,omitempty"`
}

type engineExtractionReplayMessage struct {
	ID                string `json:"id"`
	Timestamp         string `json:"timestamp"`
	TimestampFallback *bool  `json:"timestampFallback,omitempty"`
	HasSourceTime     bool   `json:"hasSourceTime,omitempty"`
}

// Failed/orphaned operations already have an exact request in the engine's
// journal. Reuse its window rather than changing that request on an upgrade or
// retry. Go rechecks marked timestamps against the current verified mirror,
// which also supplies the roles and text.
func extractionMessages(ctx context.Context, s engineExtractStore, c postgres.JobClaim, op postgres.EngineOperation, replay *engineExtractionReplay) ([]postgres.EngineExtractionMessage, string, error) {
	current, err := s.ReadEngineExtractionWindow(ctx, c, op)
	if err != nil {
		return nil, "", err
	}
	if replay == nil {
		return current, op.SourceKey, nil
	}
	if len(replay.Messages) == 0 || (replay.PrimarySourceID != "" && replay.PrimarySourceID != op.SourceKey) {
		return nil, "", postgres.ErrConflict
	}
	last := replay.Messages[len(replay.Messages)-1]
	if last.ID != op.SourceKey {
		return nil, "", postgres.ErrConflict
	}
	messages := make([]postgres.EngineExtractionMessage, 0, len(replay.Messages))
	for _, saved := range replay.Messages {
		matched := false
		for _, source := range current {
			if saved.ID == source.ID {
				if saved.TimestampFallback == nil {
					// Preserve the exact request shape of an unmarked legacy replay.
					source.TimestampFallback = nil
					source.Timestamp = saved.Timestamp
				} else if source.TimestampFallback == nil || *saved.TimestampFallback != *source.TimestampFallback || saved.Timestamp != source.Timestamp {
					return nil, "", postgres.ErrConflict
				}
				if !saved.HasSourceTime {
					source.SourceTime = nil
				} else if source.SourceTime == nil {
					return nil, "", postgres.ErrConflict
				}
				matched = true
				messages = append(messages, source)
				break
			}
		}
		if !matched {
			return nil, "", postgres.ErrConflict
		}
	}
	// The old singleton request did not include primarySourceId. Preserve that
	// absence and its original timestamp for exact journal equality.
	return messages, replay.PrimarySourceID, nil
}
