package turn

import (
	"context"
	"fmt"
	"strconv"
	"sync"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

// MemStore is the unit-test TurnStore. companiond must not wire it.
type MemStore struct {
	mu       sync.Mutex
	seeds    map[string]ContextSeed
	next     int
	attempts map[string]companion.AttemptOutcome
	phase    map[string]companion.Phase
	final    map[string]string
	reason   map[string]string
	prepared map[string]PreparedAttempt
}

func NewMemStore() *MemStore {
	return &MemStore{
		seeds:    map[string]ContextSeed{},
		attempts: map[string]companion.AttemptOutcome{},
		phase:    map[string]companion.Phase{},
		final:    map[string]string{},
		reason:   map[string]string{},
		prepared: map[string]PreparedAttempt{},
	}
}

func (m *MemStore) PutSeed(seed ContextSeed) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seeds[seed.TurnID] = seed
	m.phase[seed.TurnID] = companion.PhaseAccepted
}

func (m *MemStore) LoadSeed(_ context.Context, turnID string) (ContextSeed, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.seeds[turnID]
	if !ok {
		return ContextSeed{}, fmt.Errorf("seed not found")
	}
	return s, nil
}

func (m *MemStore) PrepareAttempt(_ context.Context, cmd PrepareAttempt) (PreparedAttempt, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cmd.TurnID == "" {
		return PreparedAttempt{}, fmt.Errorf("turn id required")
	}
	phase := m.phase[cmd.TurnID]
	if phase == companion.PhaseCompleted || phase == companion.PhaseBlocked ||
		phase == companion.PhaseFailed || phase == companion.PhaseCancelled {
		return PreparedAttempt{}, fmt.Errorf("turn already terminal")
	}
	m.next++
	id := "att-" + strconv.Itoa(m.next)
	prep := PreparedAttempt{AttemptID: id, Budget: cmd.Budget, Fence: int64(m.next)}
	m.prepared[id] = prep
	m.attempts[id] = companion.AttemptOutcome{
		TurnID:     cmd.TurnID,
		AttemptID:  id,
		Status:     companion.AttemptCreated,
		Budget:     cmd.Budget,
		Categories: categoryStrings(cmd.Categories),
	}
	m.phase[cmd.TurnID] = companion.PhasePreparing
	return prep, nil
}

func (m *MemStore) RecordAttemptOutcome(_ context.Context, outcome companion.AttemptOutcome) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.attempts[outcome.AttemptID]
	if !ok {
		return fmt.Errorf("attempt not found")
	}
	if cur.Status.Terminal() {
		return fmt.Errorf("attempt already terminal")
	}
	if !outcome.Status.Terminal() {
		return fmt.Errorf("outcome must be terminal")
	}
	outcome.TurnID = cur.TurnID
	m.attempts[outcome.AttemptID] = outcome
	return nil
}

func (m *MemStore) FinalizeGeneration(_ context.Context, cmd FinalizeCommand) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	att, ok := m.attempts[cmd.AttemptID]
	if !ok || att.TurnID != cmd.TurnID {
		return fmt.Errorf("attempt not found")
	}
	if !att.Status.Terminal() {
		return fmt.Errorf("finalize requires a closed attempt")
	}
	if att.Status != companion.AttemptSucceeded {
		return fmt.Errorf("finalize requires a succeeded attempt")
	}
	if cmd.Text == "" {
		return fmt.Errorf("finalize requires reviewed text")
	}
	if m.phase[cmd.TurnID] == companion.PhaseCompleted {
		return fmt.Errorf("turn already completed")
	}
	m.final[cmd.TurnID] = cmd.Text
	m.phase[cmd.TurnID] = companion.PhaseCompleted
	return nil
}

func (m *MemStore) TerminalizeGeneration(_ context.Context, cmd TerminalCommand) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cmd.AttemptID != "" {
		att, ok := m.attempts[cmd.AttemptID]
		if ok && att.Status.Terminal() {
			// Allowed: terminalize consumes a closed attempt and must not
			// rewrite its outcome.
		}
	}
	m.phase[cmd.TurnID] = cmd.Phase
	m.reason[cmd.TurnID] = cmd.Reason
	delete(m.final, cmd.TurnID)
	return nil
}

func (m *MemStore) Phase(turnID string) companion.Phase {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.phase[turnID]
}

func (m *MemStore) FinalText(turnID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.final[turnID]
}

func (m *MemStore) Reason(turnID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.reason[turnID]
}

func (m *MemStore) Attempt(id string) companion.AttemptOutcome {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.attempts[id]
}

func categoryStrings(in []DataCategory) []string {
	out := make([]string, 0, len(in))
	for _, c := range in {
		out = append(out, string(c))
	}
	return out
}
