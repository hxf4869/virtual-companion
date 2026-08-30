package httpapi

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func (m *memStore) CreateMemoryCandidate(_ context.Context, _ int64, in postgres.MemoryCreate) (postgres.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.rels[in.RelationshipID]; !ok {
		return postgres.Memory{}, postgres.ErrNotFound
	}
	if in.Scope != "SESSION" && in.Scope != "RELATIONSHIP" {
		return postgres.Memory{}, postgres.ErrInvalid
	}
	if in.Summary == "" {
		return postgres.Memory{}, postgres.ErrInvalid
	}
	if in.Scope == "SESSION" && (in.ConversationID == nil || m.convs[*in.ConversationID].Incognito) {
		if in.ConversationID == nil {
			return postgres.Memory{}, postgres.ErrInvalid
		}
		if m.convs[*in.ConversationID].Incognito {
			return postgres.Memory{}, postgres.ErrInvalid
		}
	}
	if in.IdempotencyKey != "" {
		if id, ok := m.idem[in.IdempotencyKey]; ok {
			return m.memories[id], nil
		}
	}
	id := m.next
	m.next++
	mem := postgres.Memory{
		ID:             id,
		RelationshipID: in.RelationshipID,
		Scope:          in.Scope,
		Summary:        in.Summary,
		Status:         "PENDING_CONFIRMATION",
		ConversationID: in.ConversationID,
		CreatedAt:      time.Unix(1, 0).UTC(),
		EventAt:        in.EventAt,
		EventStatus:    in.EventStatus,
		EventExpiresAt: in.EventExpiresAt,
	}
	m.memories[id] = mem
	ev := in.Evidence
	if len(ev) == 0 {
		ev = []string{"USER_DIRECT"}
	}
	for _, ref := range ev {
		eid := m.next
		m.next++
		m.evidence[id] = append(m.evidence[id], postgres.MemoryEvidence{ID: eid, SourceRef: ref, CreatedAt: time.Unix(1, 0).UTC()})
	}
	if in.IdempotencyKey != "" {
		m.idem[in.IdempotencyKey] = id
	}
	return mem, nil
}

func (m *memStore) ListMemories(_ context.Context, _ int64, relationshipID int64, includeDeleted bool) ([]postgres.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []postgres.Memory{}
	for _, mem := range m.memories {
		if mem.RelationshipID != relationshipID {
			continue
		}
		if !includeDeleted && mem.DeletedAt != nil {
			continue
		}
		out = append(out, mem)
	}
	return out, nil
}

func (m *memStore) GetMemory(_ context.Context, _ int64, memoryID int64) (postgres.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mem, ok := m.memories[memoryID]
	if !ok || mem.DeletedAt != nil {
		return postgres.Memory{}, postgres.ErrNotFound
	}
	return mem, nil
}

func (m *memStore) UpdateMemory(_ context.Context, _ int64, memoryID int64, summary string, eventAt *time.Time, eventStatus *string, eventExpiresAt *time.Time) (postgres.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mem, ok := m.memories[memoryID]
	if !ok || mem.DeletedAt != nil || (mem.Status != "PENDING_CONFIRMATION" && mem.Status != "ACCEPTED") {
		return postgres.Memory{}, postgres.ErrNotFound
	}
	if summary == "" {
		return postgres.Memory{}, postgres.ErrInvalid
	}
	mem.Summary = summary
	if eventAt != nil {
		mem.EventAt = eventAt
	}
	if eventStatus != nil {
		mem.EventStatus = eventStatus
	}
	if eventExpiresAt != nil {
		mem.EventExpiresAt = eventExpiresAt
	}
	m.memories[memoryID] = mem
	return mem, nil
}

func (m *memStore) DeleteMemory(_ context.Context, _ int64, memoryID int64) (postgres.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mem, ok := m.memories[memoryID]
	if !ok || mem.DeletedAt != nil {
		return postgres.Memory{}, postgres.ErrNotFound
	}
	now := time.Unix(2, 0).UTC()
	mem.DeletedAt = &now
	m.memories[memoryID] = mem
	return mem, nil
}

func (m *memStore) ConfirmMemory(_ context.Context, _ int64, memoryID int64, supersede *int64) (postgres.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mem, ok := m.memories[memoryID]
	if !ok || mem.Status != "PENDING_CONFIRMATION" || mem.DeletedAt != nil {
		return postgres.Memory{}, postgres.ErrNotFound
	}
	if supersede != nil {
		target, ok := m.memories[*supersede]
		if !ok || target.Status != "ACCEPTED" || target.SupersededAt != nil || target.RelationshipID != mem.RelationshipID {
			return postgres.Memory{}, postgres.ErrInvalid
		}
		now := time.Unix(3, 0).UTC()
		target.SupersededAt = &now
		sid := memoryID
		target.SupersededByMemoryID = &sid
		m.memories[*supersede] = target
	}
	mem.Status = "ACCEPTED"
	m.memories[memoryID] = mem
	return mem, nil
}

func (m *memStore) RejectMemory(_ context.Context, _ int64, memoryID int64) (postgres.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mem, ok := m.memories[memoryID]
	if !ok || mem.Status != "PENDING_CONFIRMATION" {
		return postgres.Memory{}, postgres.ErrNotFound
	}
	mem.Status = "REJECTED"
	m.memories[memoryID] = mem
	return mem, nil
}

func (m *memStore) ListMemoryEvidence(_ context.Context, _ int64, memoryID int64) ([]postgres.MemoryEvidence, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mem, ok := m.memories[memoryID]; !ok || mem.DeletedAt != nil {
		return []postgres.MemoryEvidence{}, nil
	}
	out := m.evidence[memoryID]
	if out == nil {
		return []postgres.MemoryEvidence{}, nil
	}
	return out, nil
}

func (m *memStore) ListConsents(context.Context, int64) ([]postgres.Consent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []postgres.Consent{}
	for _, c := range m.consents {
		out = append(out, c)
	}
	return out, nil
}

func (m *memStore) RecordConsent(_ context.Context, _ int64, consentType, version string, granted bool) (postgres.Consent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := m.next
	m.next++
	now := time.Unix(4, 0).UTC()
	c := postgres.Consent{ID: id, Type: consentType, Version: version, Granted: granted, GrantedAt: now}
	if !granted {
		c.RevokedAt = &now
	}
	m.consents[consentType] = c
	return c, nil
}

func (m *memStore) GetIncognitoPref(context.Context, int64) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.incognito, nil
}

func (m *memStore) UpdateIncognitoPref(_ context.Context, _ int64, v bool) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.incognito = v
	return v, nil
}

func (m *memStore) OutboundCheck(_ context.Context, _ int64) (postgres.OutboundDecision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var list []postgres.Consent
	for _, c := range m.consents {
		list = append(list, c)
	}
	return postgres.DecideOutbound(list, m.deleting), nil
}

func (m *memStore) CreateReport(_ context.Context, _ int64, messageID *int64, reason, note string) (postgres.Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if messageID != nil {
		if _, ok := m.msgs[*messageID]; !ok {
			return postgres.Report{}, postgres.ErrNotFound
		}
	}
	id := m.next
	m.next++
	rec := postgres.Report{ID: id, MessageID: messageID, Reason: reason, Note: strings.TrimSpace(note), Status: "SUBMITTED", CreatedAt: time.Unix(5, 0).UTC()}
	m.reports[id] = rec
	return rec, nil
}

func (m *memStore) ListReports(context.Context, int64, *int64, *int) ([]postgres.Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []postgres.Report{}
	for _, r := range m.reports {
		out = append(out, r)
	}
	return out, nil
}

func (m *memStore) CreateExport(_ context.Context, _ int64, token string) (postgres.Export, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.deleting {
		return postgres.Export{}, postgres.ErrNotFound
	}
	for _, e := range m.exports {
		if e.Status == "PENDING" {
			return postgres.Export{}, postgres.ErrConflict
		}
	}
	id := m.next
	m.next++
	rec := postgres.Export{ID: id, Status: "PENDING", RequestedAt: time.Unix(6, 0).UTC()}
	m.exports[id] = rec
	m.exportTok[id] = token
	return rec, nil
}

func (m *memStore) GetExport(_ context.Context, _ int64, exportID int64) (postgres.Export, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.exports[exportID]
	if !ok {
		return postgres.Export{}, postgres.ErrNotFound
	}
	return e, nil
}

func (m *memStore) ConsumeExport(_ context.Context, _ int64, exportID int64, token string) (postgres.ExportDownload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.exports[exportID]
	if !ok || e.Status != "READY" || m.exportTok[exportID] != token || m.exportTok[exportID] == "" {
		return postgres.ExportDownload{}, postgres.ErrNotFound
	}
	m.exportTok[exportID] = ""
	exp := time.Unix(9, 0).UTC()
	if e.ExpiresAt != nil {
		exp = *e.ExpiresAt
	}
	return postgres.ExportDownload{Payload: m.exportBody[exportID], ExpiresAt: exp}, nil
}

func (m *memStore) CompleteExport(_ context.Context, _ int64, exportID int64, payload string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.exports[exportID]
	if !ok || e.Status != "PENDING" {
		return postgres.ErrNotFound
	}
	e.Status = "READY"
	e.CompletedAt = &expiresAt
	e.ExpiresAt = &expiresAt
	m.exports[exportID] = e
	m.exportBody[exportID] = payload
	return nil
}

func (m *memStore) CompleteExportObject(context.Context, int64, int64, string, int64, time.Time) error {
	return postgres.ErrInvalid
}

func (m *memStore) FailExportWithObject(context.Context, int64, int64, string, int64, string) error {
	return postgres.ErrInvalid
}

func (m *memStore) RecordExportUploadIntent(context.Context, int64, int64, string, int) (int64, error) {
	return 0, postgres.ErrInvalid
}

func (m *memStore) ListOwnerExportObjects(context.Context, int64) ([]postgres.ExportObject, error) {
	return []postgres.ExportObject{}, nil
}

func (m *memStore) ClearExportObject(context.Context, int64, int64, string) error {
	return nil
}

func (m *memStore) LookupIdentity(_ context.Context, username string) (postgres.Identity, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.identities[strings.ToLower(username)]
	if ok && id.Username == "" {
		id.Username = strings.ToLower(username)
	}
	return id, ok && !m.deleted, nil
}

func (m *memStore) Lookup(_ context.Context, token string) (*auth.Principal, error) {
	return m.LookupOpaqueSession(context.Background(), auth.TokenHash(token))
}

func (m *memStore) IssueOpaqueSession(_ context.Context, accountID int64, tokenHash string, expires time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := m.next
	m.next++
	now := time.Now().UTC()
	m.sessions[id] = memSession{ID: id, AccountID: accountID, TokenHash: tokenHash, CreatedAt: now, ExpiresAt: expires.UTC()}
	m.byHash[tokenHash] = id
	return id, nil
}

func (m *memStore) LookupOpaqueSession(_ context.Context, tokenHash string) (*auth.Principal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sid, ok := m.byHash[tokenHash]
	if !ok {
		return nil, nil
	}
	sess := m.sessions[sid]
	if !sess.RevokedAt.IsZero() || !sess.ExpiresAt.After(time.Now()) {
		return nil, nil
	}
	ident, ok := m.identityByAccount(sess.AccountID)
	if !ok || ident.Status != "ACTIVE" || m.deleted {
		return nil, nil
	}
	return &auth.Principal{
		AccountID:          ident.AccountID,
		Role:               ident.Role,
		Username:           ident.Username,
		SessionID:          sess.ID,
		ReauthAt:           sess.ReauthAt,
		PasswordMustChange: ident.PasswordMustChange,
	}, nil
}

func (m *memStore) identityByAccount(accountID int64) (postgres.Identity, bool) {
	for _, id := range m.identities {
		if id.AccountID == accountID {
			if id.Username == "" {
				if accountID == 2 {
					id.Username = "bob"
				} else {
					id.Username = "alice"
				}
			}
			return id, true
		}
	}
	return postgres.Identity{}, false
}

func (m *memStore) ListOpaqueSessions(_ context.Context, accountID int64) ([]postgres.OpaqueSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []postgres.OpaqueSession
	now := time.Now()
	for _, sess := range m.sessions {
		if sess.AccountID != accountID || !sess.RevokedAt.IsZero() || !sess.ExpiresAt.After(now) {
			continue
		}
		out = append(out, postgres.OpaqueSession{ID: sess.ID, CreatedAt: sess.CreatedAt, ExpiresAt: sess.ExpiresAt, ReauthAt: sess.ReauthAt})
	}
	return out, nil
}

func (m *memStore) RevokeOpaqueSession(_ context.Context, accountID, sessionID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	sess, ok := m.sessions[sessionID]
	if !ok || sess.AccountID != accountID || !sess.RevokedAt.IsZero() {
		return postgres.ErrNotFound
	}
	sess.RevokedAt = time.Now()
	m.sessions[sessionID] = sess
	return nil
}

func (m *memStore) RevokeOpaqueSessionHash(_ context.Context, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	sid, ok := m.byHash[tokenHash]
	if !ok {
		return nil
	}
	sess := m.sessions[sid]
	if sess.RevokedAt.IsZero() {
		sess.RevokedAt = time.Now()
		m.sessions[sid] = sess
	}
	return nil
}

func (m *memStore) RevokeAllOpaqueSessions(_ context.Context, accountID int64) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	now := time.Now()
	for id, sess := range m.sessions {
		if sess.AccountID == accountID && sess.RevokedAt.IsZero() {
			sess.RevokedAt = now
			m.sessions[id] = sess
			n++
		}
	}
	return n, nil
}

func (m *memStore) RecordOpaqueReauth(_ context.Context, accountID, sessionID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	sess, ok := m.sessions[sessionID]
	if !ok || sess.AccountID != accountID || !sess.RevokedAt.IsZero() {
		return postgres.ErrNotFound
	}
	sess.ReauthAt = time.Now()
	m.sessions[sessionID] = sess
	return nil
}

func (m *memStore) ChangePasswordHash(_ context.Context, accountID int64, passwordHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for user, id := range m.identities {
		if id.AccountID == accountID {
			id.PasswordHash = passwordHash
			id.PasswordMustChange = false
			m.identities[user] = id
			found = true
		}
	}
	if !found {
		return postgres.ErrNotFound
	}
	now := time.Now()
	for id, sess := range m.sessions {
		if sess.AccountID == accountID && sess.RevokedAt.IsZero() {
			sess.RevokedAt = now
			m.sessions[id] = sess
		}
	}
	return nil
}

func (m *memStore) RequestAccountDeletion(context.Context, int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.deleted {
		return postgres.ErrNotFound
	}
	m.deleting = true
	return nil
}

func (m *memStore) DeletionIntentActive(context.Context, int64) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.deleting, nil
}

type memBlob struct {
	mu sync.Mutex
	m  map[string][]byte
}

func newMemBlob() *memBlob {
	return &memBlob{m: map[string][]byte{}}
}

func (b *memBlob) Put(_ context.Context, key string, data []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	cp := append([]byte(nil), data...)
	b.m[key] = cp
	return nil
}

func (b *memBlob) Get(_ context.Context, key string) ([]byte, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	v, ok := b.m[key]
	if !ok {
		return nil, postgres.ErrNotFound
	}
	return append([]byte(nil), v...), nil
}

func (b *memBlob) Delete(_ context.Context, key string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.m, key)
	return nil
}

func (m *memStore) DeleteAccount(context.Context, int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.deleting {
		return postgres.ErrNotFound
	}
	m.deleted = true
	return nil
}
