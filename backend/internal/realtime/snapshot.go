package realtime

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

// Snapshot is the durable generation view used when the hub is absent or
// after a terminal commit. Partial in-flight text is never invented here.
type Snapshot struct {
	// Terminal is empty while the generation is still running.
	Terminal companion.PublicEvent
	Text     string
}

// Snapshots is the short owner-bound read used by authenticated SSE.
// Load must not hold a transaction after it returns.
type Snapshots interface {
	Load(ctx context.Context, ownerUserID int64, generationID string) (Snapshot, bool, error)
}
