//go:build integration && sx8performance

package postgres

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt in with -tags=integration,sx8performance and select exactly one test.
// Acceptance must run alone with GOMAXPROCS=2. Smoke uses 32 messages and is
// infrastructure debugging only; its results never satisfy the 20k acceptance.
func TestSX8TransferPerformanceAcceptance(t *testing.T) { sx8PerfRun(t, 20000, true) }
func TestSX8TransferPerformanceSmoke(t *testing.T)      { sx8PerfRun(t, 32, false) }

// This adapter deliberately measures local encrypted-file IO, not MinIO/S3
// network latency. Each Put/Get uses the production FieldCipher enc2 envelope,
// with at most one 1 MiB plaintext chunk and its envelope resident per call.
// A postgres-package test cannot import blobstore (which imports postgres).
// The caller's shell owns SX8_PERF_TMPDIR and removes it on EXIT/INT/TERM;
// t.Cleanup additionally removes the unique test-owned directory normally.
type sx8PerfFiles struct {
	root   string
	cipher *FieldCipher
}

func sx8PerfNewFiles(t *testing.T, cipher *FieldCipher) *sx8PerfFiles {
	t.Helper()
	root, err := os.MkdirTemp(os.Getenv("SX8_PERF_TMPDIR"), "vc-sx8-performance-")
	sx8PerfRequire(t, err, "temporary_directory")
	t.Cleanup(func() {
		if os.RemoveAll(root) != nil {
			t.Error("temporary_directory_cleanup_failed")
		}
	})
	return &sx8PerfFiles{root, cipher}
}
func (o *sx8PerfFiles) path(key string) (string, error) {
	if !filepath.IsLocal(key) {
		return "", errors.New("invalid_object_key")
	}
	return filepath.Join(o.root, filepath.FromSlash(key)), nil
}
func (o *sx8PerfFiles) Put(ctx context.Context, key string, b []byte) (int64, error) {
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	if len(b) > chattransfer.ChunkBytes {
		return 0, errors.New("oversize_chunk")
	}
	path, err := o.path(key)
	if err != nil {
		return 0, err
	}
	envelope, err := o.cipher.Encrypt(string(b))
	if err != nil {
		return 0, err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return 0, err
	}
	if err = os.WriteFile(path, []byte(envelope), 0600); err != nil {
		return 0, err
	}
	return int64(len(envelope)), nil
}
func (o *sx8PerfFiles) GetLimited(ctx context.Context, key string, n int64) ([]byte, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if n < 0 || n > chattransfer.ChunkBytes {
		return nil, errors.New("invalid_chunk_limit")
	}
	path, err := o.path(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("object_open_failed")
	}
	defer f.Close()
	envelope, err := io.ReadAll(io.LimitReader(f, ((n+28+2)/3)*4+128))
	if err != nil || !strings.HasPrefix(string(envelope), o.cipher.CurrentPrefix()) {
		return nil, errors.New("object_envelope_failed")
	}
	plain, err := o.cipher.Decrypt(string(envelope))
	if err != nil || int64(len(plain)) > n {
		return nil, errors.New("object_decrypt_failed")
	}
	return []byte(plain), nil
}
func (o *sx8PerfFiles) Delete(ctx context.Context, key string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	path, err := o.path(key)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
func (o *sx8PerfFiles) ListKeys(ctx context.Context, prefix, after string, limit int) ([]string, error) {
	keys := []string{}
	err := filepath.WalkDir(o.root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(o.root, path)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(rel)
		if strings.HasPrefix(key, prefix) && key > after {
			keys = append(keys, key)
		}
		return nil
	})
	sort.Strings(keys)
	if len(keys) > limit {
		keys = keys[:limit]
	}
	return keys, err
}

// A marker follows only the measured native save. Preparation takes read locks;
// the first lock_chat_authority(...,true) is the final publication transaction.
// Actual lock acquisition lies in [lockStart,lockEnd], release in
// [commitStart,commitEnd]. Therefore [lockEnd,commitStart] is a lower bound and
// [lockStart,commitEnd] an upper bound for BOTH the owner row and memory barrier.
type sx8PerfMarker struct{}
type sx8PerfQuery struct{}
type sx8PerfTracer struct {
	mu                                         sync.Mutex
	lockStart, lockEnd, commitStart, commitEnd time.Time
	pid                                        uint32
	acquired                                   chan struct{}
	once                                       sync.Once
	onLock                                     func(context.Context)
}

func (tr *sx8PerfTracer) TraceQueryStart(ctx context.Context, c *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	if ctx.Value(sx8PerfMarker{}) == nil {
		return ctx
	}
	kind := ""
	if strings.Contains(d.SQL, "FROM vc.lock_chat_authority(") && len(d.Args) == 2 && d.Args[1] == true {
		kind = "lock"
	}
	tr.mu.Lock()
	if strings.EqualFold(strings.TrimSpace(d.SQL), "commit") && !tr.lockEnd.IsZero() && tr.commitEnd.IsZero() {
		kind = "commit"
	}
	if kind == "lock" && tr.lockStart.IsZero() {
		tr.lockStart = time.Now()
		tr.pid = c.PgConn().PID()
	}
	if kind == "commit" {
		tr.commitStart = time.Now()
	}
	tr.mu.Unlock()
	if kind != "" {
		return context.WithValue(ctx, sx8PerfQuery{}, kind)
	}
	return ctx
}
func (tr *sx8PerfTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryEndData) {
	kind, _ := ctx.Value(sx8PerfQuery{}).(string)
	if kind == "" {
		return
	}
	tr.mu.Lock()
	if kind == "lock" && d.Err == nil {
		tr.lockEnd = time.Now()
	}
	if kind == "commit" {
		tr.commitEnd = time.Now()
	}
	tr.mu.Unlock()
	if kind == "lock" && d.Err == nil {
		tr.once.Do(func() { close(tr.acquired) })
		if tr.onLock != nil {
			tr.onLock(ctx)
		}
	}
}
func sx8PerfStore(t *testing.T, base *Store, name string, tracer pgx.QueryTracer) *Store {
	t.Helper()
	cfg := base.pool.Config()
	cfg.ConnConfig.Tracer = tracer
	cfg.ConnConfig.RuntimeParams["application_name"] = name
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	sx8PerfRequire(t, err, "measurement_pool")
	s := &Store{pool: pool, secret: base.secret, txTimeout: 5 * time.Second, cipher: base.cipher,
		maxReservedCost: base.maxReservedCost, monthlyCostLimit: base.monthlyCostLimit, stSources: base.stSources}
	t.Cleanup(s.Close)
	return s
}

// HeapAlloc is sampled every 10ms, including a synchronous start/end sample.
// RSS is getrusage's process lifetime high-water, not a per-phase delta; it
// includes fixture construction and excludes PostgreSQL/container memory.
type sx8PerfMemory struct {
	stop           chan struct{}
	done           chan struct{}
	peak, baseline uint64
}

func sx8PerfStartMemory() *sx8PerfMemory {
	runtime.GC()
	m := &sx8PerfMemory{stop: make(chan struct{}), done: make(chan struct{})}
	var st runtime.MemStats
	runtime.ReadMemStats(&st)
	m.peak = st.HeapAlloc
	m.baseline = st.HeapAlloc
	go func() {
		defer close(m.done)
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				runtime.ReadMemStats(&st)
				m.peak = max(m.peak, st.HeapAlloc)
			case <-m.stop:
				runtime.ReadMemStats(&st)
				m.peak = max(m.peak, st.HeapAlloc)
				return
			}
		}
	}()
	return m
}
func (m *sx8PerfMemory) finish(t *testing.T, phase string, elapsed time.Duration) {
	close(m.stop)
	<-m.done
	var usage syscall.Rusage
	sx8PerfRequire(t, syscall.Getrusage(syscall.RUSAGE_SELF, &usage), "process_RSS")
	rss := uint64(usage.Maxrss)
	if runtime.GOOS != "darwin" {
		rss *= 1024
	}
	t.Logf("phase=%s elapsed_ms=%d baseline_Go_heap_bytes=%d peak_Go_heap_bytes=%d lifetime_peak_process_RSS_bytes=%d heap_sample_ms=10", phase, elapsed.Milliseconds(), m.baseline, m.peak, rss)
}
func sx8PerfRequire(t *testing.T, err error, step string) {
	t.Helper()
	if err != nil {
		t.Fatalf("step=%s error_class=%s", step, sx8PerfError(err))
	}
}
func sx8PerfError(err error) string {
	if err == nil {
		return "OK"
	}
	var ce *ChatError
	if errors.As(err, &ce) {
		return ce.Code
	}
	switch {
	case errors.Is(err, ErrOwnerContextRejected):
		return "OWNER_CONTEXT_REJECTED"
	case errors.Is(err, ErrConflict):
		return "CONFLICT"
	case errors.Is(err, errStore):
		return "STORE_UNAVAILABLE"
	case errors.Is(err, context.DeadlineExceeded):
		return "DEADLINE"
	case errors.Is(err, context.Canceled):
		return "CANCELED"
	}
	return "OTHER"
}

func sx8PerfStage(t *testing.T, s *Store, o chattransfer.Objects, fill func(io.Writer) error) (ChatTransferIntent, chattransfer.Manifest, string) {
	t.Helper()
	ctx := t.Context()
	intent, err := s.BeginChatTransfer(ctx, 1)
	sx8PerfRequire(t, err, "begin_stage")
	writer := chattransfer.NewWriter(ctx, o, intent.Prefix, chatjsonl.MaxFileBytes)
	hash := sha256.New()
	sx8PerfRequire(t, fill(io.MultiWriter(writer, hash)), "fill_stage")
	manifest, err := writer.Seal()
	sx8PerfRequire(t, err, "seal_stage")
	// SHA256 is required by the existing transfer protocol receipt identity.
	return intent, manifest, fmt.Sprintf("%x", hash.Sum(nil))
}
func sx8PerfReader(t *testing.T, o chattransfer.Objects, m chattransfer.Manifest) io.Reader {
	t.Helper()
	r, err := chattransfer.NewReader(t.Context(), o, m)
	sx8PerfRequire(t, err, "read_stage")
	return r
}

type sx8PerfContender struct {
	elapsed time.Duration
	err     error
	attempt MemoryExtractPreparation
}
type sx8PerfBlocking struct {
	chat, memory int
	first, last  time.Time
	err          error
}

func sx8PerfObserve(ctx context.Context, c *pgx.Conn, tr *sx8PerfTracer, done <-chan struct{}) sx8PerfBlocking {
	out := sx8PerfBlocking{}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return out
		case <-ctx.Done():
			out.err = ctx.Err()
			return out
		case <-ticker.C:
			tr.mu.Lock()
			pid := tr.pid
			tr.mu.Unlock()
			var chat, memory int
			err := c.QueryRow(ctx, `SELECT count(*) FILTER(WHERE application_name='sx8-perf-chat'),count(*) FILTER(WHERE application_name='sx8-perf-memory') FROM pg_stat_activity WHERE wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))`, int32(pid)).Scan(&chat, &memory)
			if err != nil {
				out.err = err
				return out
			}
			out.chat += chat
			out.memory += memory
			if chat+memory > 0 {
				if out.first.IsZero() {
					out.first = time.Now()
				}
				out.last = time.Now()
			}
		}
	}
}

func sx8PerfRun(t *testing.T, count int, acceptance bool) {
	if runtime.GOMAXPROCS(0) != 2 {
		t.Fatal("GOMAXPROCS_must_equal_2")
	}
	ctx := t.Context()
	base := sx8PerfSetup(t)
	sx8PerfRequire(t, IsolationSuperExec(ctx, `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2)`), "GO_authority")
	tr := &sx8PerfTracer{acquired: make(chan struct{})}
	s := sx8PerfStore(t, base, "sx8-perf-native", tr)
	chatStore := sx8PerfStore(t, base, "sx8-perf-chat", nil)
	memoryStore := sx8PerfStore(t, base, "sx8-perf-memory", nil)
	objects := sx8PerfNewFiles(t, s.cipher)
	group := "synthetic-performance"
	character := "synthetic-performance-main"
	scope := NativeChatScope{Kind: "SINGLE", CharacterRef: &character}
	small, err := s.CreateStoredChat(ctx, 1, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group})
	sx8PerfRequire(t, err, "ordinary_chat_fixture")
	input := NativeChatUpload{RequestID: chatUUID(), AuthorityEpoch: 2, Scope: scope, Mode: "COMPANION", ChatID: chatUUID(), FileName: "synthetic-performance.jsonl"}
	// The seed is generated one JSONL message at a time; no []message/whole body.
	// Canonical export repeats the selected body in mes and swipes; 1088 body
	// bytes plus protected metadata makes 20k complete messages about 50 MiB.
	original := strings.Repeat("a", 1088)
	replacement := strings.Repeat("b", 1088)
	intent, manifest, hash := sx8PerfStage(t, s, objects, func(dst io.Writer) error {
		w := chatjsonl.NewWriter(dst)
		if err := w.WriteHeader(chatjsonl.Object{}); err != nil {
			return err
		}
		for i := 0; i < count; i++ {
			if err := w.WriteMessage(chatjsonl.Object{"mes": original, "is_user": true, "extra": chatjsonl.Object{"no_memory": true}}); err != nil {
				return err
			}
		}
		return nil
	})
	created, err := s.WriteNativeChat(ctx, 1, "create", input, intent.ID, manifest, hash, objects)
	sx8PerfRequire(t, err, "native_create_fixture")
	if created.Chat.MessageCount != int64(count) || created.Chat.Revision != 1 {
		t.Fatal("native_create_fixture_count_or_revision")
	}
	created.IdentityMapping = nil

	exportMemory := sx8PerfStartMemory()
	exportStart := time.Now()
	exportIntent, err := s.BeginChatTransfer(ctx, 1)
	sx8PerfRequire(t, err, "begin_export")
	exportWriter := chattransfer.NewWriter(ctx, objects, exportIntent.Prefix, 0)
	snapshot, err := s.CaptureStoredChatJSONL(ctx, 1, input.ChatID, nil, exportWriter)
	sx8PerfRequire(t, err, "capture_export")
	exported, err := exportWriter.Seal()
	sx8PerfRequire(t, err, "seal_export")
	var delivered int64
	err = s.DeliverStoredChatSnapshot(ctx, 1, snapshot, func(sendCtx context.Context) error {
		r, err := chattransfer.NewReader(sendCtx, objects, exported)
		if err != nil {
			return err
		}
		delivered, err = io.Copy(io.Discard, r)
		return err
	})
	sx8PerfRequire(t, err, "deliver_export")
	exportMemory.finish(t, "export_capture_encrypt_deliver", time.Since(exportStart))
	if delivered != snapshot.Bytes || delivered != exported.Bytes {
		t.Fatal("export_byte_count_mismatch")
	}
	if acceptance && (exported.Bytes < 45<<20 || exported.Bytes > 60<<20) {
		t.Fatal("export_fixture_not_approximately_50MiB")
	}
	t.Logf("messages=%d export_bytes=%d staging=local_files_FieldCipher_enc2_1MiB_chunks gomaxprocs=2 acceptance=%t", count, exported.Bytes, acceptance)

	// A separate SINGLE/COMPANION Go source creates a real eligible memory job.
	// Claim it after the large fixture setup, retaining the same token/fence on retry.
	anchorCharacter := "synthetic-performance-memory"
	anchor, err := s.CreateStoredChat(ctx, 1, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "SINGLE", CharacterRef: &anchorCharacter, Mode: "COMPANION"})
	sx8PerfRequire(t, err, "GO_memory_anchor_create")
	_, err = s.AppendStoredMessages(ctx, 1, anchor.ChatID, sx5AppendRequest(anchor, ChatData{"mes": "synthetic memory anchor", "is_user": true}))
	sx8PerfRequire(t, err, "GO_memory_anchor_append")
	claims, err := s.ClaimJobs(ctx, 15*time.Minute, 15*time.Minute, 15*time.Minute, 8, 0, 1)
	sx8PerfRequire(t, err, "GO_memory_claim")
	if len(claims) != 1 || claims[0].Kind != "ST_MEMORY_EXTRACT" {
		t.Fatal("GO_memory_claim_not_unique")
	}
	job := claims[0]
	memoryInput := MemoryCoreCall{Owner: 1, Job: job.JobID, Source: job.RefID, ClaimToken: job.Token, ClaimFence: job.Fence, OperationID: "synthetic-perf-operation", Stage: "l1-extraction", CallSequence: 1, ProviderID: "prov-a", SupplierName: "Synthetic", ModelID: "model-a", InputTokens: 100, OutputTokens: 64}
	appendInput := sx5AppendRequest(small, ChatData{"mes": "synthetic concurrent write", "is_user": true})
	observer, err := pgx.Connect(ctx, IsolationSuperDSN())
	sx8PerfRequire(t, err, "lock_observer")
	defer observer.Close(context.Background())
	saveMemory := sx8PerfStartMemory()
	saveStart := time.Now()
	changed := 0
	saveIntent, saveManifest, saveHash := sx8PerfStage(t, s, objects, func(dst io.Writer) error {
		w := chatjsonl.NewWriter(dst)
		result, err := chatjsonl.Read(sx8PerfReader(t, objects, exported), chatjsonl.Handlers{OnHeader: w.WriteHeader, OnMessage: func(_ int, m chatjsonl.Object) error {
			if m["mes"] != original {
				return errors.New("unexpected_fixture_body")
			}
			m["mes"] = replacement
			if swipes, ok := m["swipes"].([]any); ok {
				for i := range swipes {
					swipes[i] = replacement
				}
			}
			changed++
			return w.WriteMessage(m)
		}})
		if err != nil {
			return err
		}
		if !result.Valid() {
			return errors.New("rewrite_invalid_JSONL")
		}
		return nil
	})
	if changed != count {
		t.Fatal("whole_save_did_not_change_every_message")
	}
	input.RequestID = chatUUID()
	input.ChatRevision = 1
	stageElapsed := time.Since(saveStart)
	measuredCtx := context.WithValue(ctx, sx8PerfMarker{}, true)
	type saveResult struct {
		out NativeChatWriteResult
		err error
	}
	savedCh := make(chan saveResult, 1)
	publishStart := time.Now()
	go func() {
		out, err := s.WriteNativeChat(measuredCtx, 1, "save", input, saveIntent.ID, saveManifest, saveHash, objects)
		savedCh <- saveResult{out, err}
	}()
	select {
	case <-tr.acquired:
	case saved := <-savedCh:
		sx8PerfRequire(t, saved.err, "save_before_lock")
		t.Fatal("final_publication_lock_not_observed")
	case <-ctx.Done():
		t.Fatal("performance_test_canceled")
	}
	chatCh := make(chan sx8PerfContender, 1)
	memoryCh := make(chan sx8PerfContender, 1)
	go func() {
		start := time.Now()
		_, err := chatStore.AppendStoredMessages(ctx, 1, small.ChatID, appendInput)
		chatCh <- sx8PerfContender{elapsed: time.Since(start), err: err}
	}()
	go func() {
		start := time.Now()
		attempt, err := memoryStore.PrepareMemoryCoreCall(ctx, memoryInput)
		memoryCh <- sx8PerfContender{time.Since(start), err, attempt}
	}()
	observedCh := make(chan sx8PerfBlocking, 1)
	observeDone := make(chan struct{})
	go func() { observedCh <- sx8PerfObserve(ctx, observer, tr, observeDone) }()
	saved := <-savedCh
	saveElapsed := time.Since(saveStart)
	publishElapsed := time.Since(publishStart)
	close(observeDone)
	blocking := <-observedCh
	saveMemory.finish(t, "whole_save_upload_prepare_publish", saveElapsed)
	t.Logf("whole_save_upload_staging_ms=%d native_prepare_publish_ms=%d changed_messages=%d", stageElapsed.Milliseconds(), publishElapsed.Milliseconds(), changed)
	sx8PerfRequire(t, saved.err, "native_whole_save")
	if acceptance && saveElapsed > 150*time.Second {
		t.Error("native_whole_save_exceeded_150_second_request_budget")
	}
	if saved.out.Chat.Revision != 2 || saved.out.Chat.MessageCount != int64(count) {
		t.Fatal("native_whole_save_ACK_or_count")
	}
	sx8PerfRequire(t, blocking.err, "lock_observation")
	tr.mu.Lock()
	lower := tr.commitStart.Sub(tr.lockEnd)
	upper := tr.commitEnd.Sub(tr.lockStart)
	acquireWindow := tr.lockEnd.Sub(tr.lockStart)
	releaseWindow := tr.commitEnd.Sub(tr.commitStart)
	validWindow := !tr.lockStart.IsZero() && !tr.lockEnd.IsZero() && !tr.commitStart.IsZero() && !tr.commitEnd.IsZero()
	tr.mu.Unlock()
	if !validWindow || lower < 0 || upper < lower {
		t.Fatal("invalid_publication_lock_measurement")
	}
	t.Logf("owner_and_memory_lock_hold_lower_ms=%d owner_and_memory_lock_hold_upper_ms=%d acquire_uncertainty_ms=%d release_uncertainty_ms=%d chat_blocked_samples=%d memory_blocked_samples=%d observed_wait_span_ms=%d", lower.Milliseconds(), upper.Milliseconds(), acquireWindow.Milliseconds(), releaseWindow.Milliseconds(), blocking.chat, blocking.memory, blocking.last.Sub(blocking.first).Milliseconds())
	if acceptance && (blocking.chat == 0 || blocking.memory == 0) {
		t.Error("real_chat_and_memory_blocking_not_both_observed")
	}
	chatOutcome := <-chatCh
	memoryOutcome := <-memoryCh
	t.Logf("ordinary_chat_elapsed_ms=%d ordinary_chat_error_class=%s memory_task_elapsed_ms=%d memory_task_error_class=%s", chatOutcome.elapsed.Milliseconds(), sx8PerfError(chatOutcome.err), memoryOutcome.elapsed.Milliseconds(), sx8PerfError(memoryOutcome.err))
	// Always try the exact original chat request after publication. A successful
	// first attempt must return its receipt, never append twice.
	_, err = chatStore.AppendStoredMessages(ctx, 1, small.ChatID, appendInput)
	sx8PerfRequire(t, err, "ordinary_chat_same_request_retry")
	ordinary, err := chatStore.GetStoredChat(ctx, 1, small.ChatID)
	sx8PerfRequire(t, err, "ordinary_chat_readback")
	if ordinary.MessageCount != 1 {
		t.Error("ordinary_chat_retry_lost_or_duplicated_write")
	}
	if chatOutcome.err != nil && !errors.Is(chatOutcome.err, errStore) {
		t.Error("ordinary_chat_failure_requires_HTTP_retryability_evidence")
	}
	// errStore reaches writeStoredChatError's HTTP503 SCHEMA_UNAVAILABLE fallback;
	// report the actual class. Never treat ErrConflict/owner rejection as retryable.
	if chatOutcome.err != nil && errors.Is(chatOutcome.err, errStore) {
		t.Log("ordinary_chat_HTTP_mapping=503_SCHEMA_UNAVAILABLE source=stored_chat.go_writeStoredChatError")
	}
	if memoryOutcome.err != nil && !errors.Is(memoryOutcome.err, errStore) {
		t.Error("memory_task_failure_requires_worker_retryability_evidence")
	}
	attempt := memoryOutcome.attempt
	if memoryOutcome.err != nil {
		attempt, err = memoryStore.PrepareMemoryCoreCall(ctx, memoryInput)
		sx8PerfRequire(t, err, "memory_same_claim_retry")
	}
	if attempt.AttemptID <= 0 || (attempt.Decision != "EXTRACTABLE" && attempt.Decision != "RETRY_TIMEOUT") {
		t.Fatal("memory_task_retry_did_not_prepare")
	}
	tokensIn, tokensOut := int64(10), int64(4)
	n, err := memoryStore.RecordMemoryExtractOutcome(ctx, 1, job.JobID, attempt.AttemptID, MemoryExtractOutcome{Status: "SUCCEEDED", InputTokens: &tokensIn, OutputTokens: &tokensOut})
	sx8PerfRequire(t, err, "memory_task_finish")
	if n != 1 {
		t.Error("memory_task_outcome_missing")
	}
	var attempts, succeeded int
	sx8PerfRequire(t, observer.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE status='SUCCEEDED') FROM vc.memory_extract_attempt WHERE owner_user_id=1 AND work_item_id=$1 AND memorycore_operation_id=$2`, job.JobID, memoryInput.OperationID).Scan(&attempts, &succeeded), "memory_task_readback")
	if attempts != 1 || succeeded != 1 {
		t.Error("memory_task_retry_lost_or_duplicated_outcome")
	}
	// Simulate an ACK lost after commit by discarding it and replaying the exact
	// upload/request, then verify every canonical body rather than only counts.
	replay, err := s.WriteNativeChat(ctx, 1, "save", input, saveIntent.ID, saveManifest, saveHash, objects)
	sx8PerfRequire(t, err, "lost_ACK_same_request_replay")
	var sourceRows, rewrittenSources int
	sx8PerfRequire(t, observer.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE s.source_revision=2 AND s.source_generation=2 AND NOT s.eligible AND s.content_cipher='') FROM vc.st_message_source s JOIN vc.stored_chat c ON c.owner_user_id=s.owner_user_id AND c.conversation_id=s.conversation_id WHERE c.owner_user_id=1 AND c.chat_id=$1`, input.ChatID).Scan(&sourceRows, &rewrittenSources), "source_projection_readback")
	if sourceRows != count || rewrittenSources != count {
		t.Error("whole_save_source_projection_or_versions_missing")
	}
	t.Logf("source_rows=%d rewritten_source_versions=%d fixture=SINGLE_COMPANION_no_memory", sourceRows, rewrittenSources)
	if replay.Chat.Revision != 2 || replay.Chat.ChatID != saved.out.Chat.ChatID {
		t.Error("lost_ACK_replay_changed_identity_or_revision")
	}
	finalIntent, err := s.BeginChatTransfer(ctx, 1)
	sx8PerfRequire(t, err, "final_readback_begin")
	finalWriter := chattransfer.NewWriter(ctx, objects, finalIntent.Prefix, 0)
	finalSnapshot, err := s.CaptureStoredChatJSONL(ctx, 1, input.ChatID, nil, finalWriter)
	sx8PerfRequire(t, err, "final_readback_capture")
	finalManifest, err := finalWriter.Seal()
	sx8PerfRequire(t, err, "final_readback_seal")
	verified := 0
	result, err := chatjsonl.Read(sx8PerfReader(t, objects, finalManifest), chatjsonl.Handlers{OnMessage: func(_ int, m chatjsonl.Object) error {
		if m["mes"] != replacement {
			return errors.New("rewritten_body_missing")
		}
		verified++
		return nil
	}})
	sx8PerfRequire(t, err, "final_full_body_readback")
	if !result.Valid() || verified != count || finalSnapshot.Revision != 2 {
		t.Error("whole_save_or_receipt_replay_lost_data")
	}
	sx8PerfTimeoutReplay(t, s, objects, ordinary)
	t.Logf("verified_rewritten_messages=%d ordinary_chat_messages=%d memory_attempts=%d memory_succeeded=%d receipt_replay_revision=%d", verified, ordinary.MessageCount, attempts, succeeded, replay.Chat.Revision)
}

// Inject a real caller deadline exactly after native publication acquires its
// locks. Only the test tracer waits: production code, SQL and transaction
// deadlines remain unchanged. The small existing chat avoids another 50MiB save.
func sx8PerfTimeoutReplay(t *testing.T, s *Store, objects chattransfer.Objects, chat StoredChat) {
	t.Helper()
	intent, manifest, hash := sx8PerfStage(t, s, objects, func(dst io.Writer) error {
		_, err := s.CaptureStoredChatJSONL(t.Context(), 1, chat.ChatID, nil, dst)
		return err
	})
	input := NativeChatUpload{RequestID: chatUUID(), AuthorityEpoch: 2, Scope: NativeChatScope{Kind: chat.Kind, GroupRef: chat.GroupRef}, ChatID: chat.ChatID, ChatRevision: chat.Revision, FileName: chat.ChatID + ".jsonl"}
	tr := &sx8PerfTracer{acquired: make(chan struct{}), onLock: func(ctx context.Context) { <-ctx.Done() }}
	faultStore := sx8PerfStore(t, s, "sx8-perf-timeout", tr)
	deadline, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	_, err := faultStore.WriteNativeChat(context.WithValue(deadline, sx8PerfMarker{}, true), 1, "save", input, intent.ID, manifest, hash, objects)
	if sx8PerfError(err) != "CHAT_TRANSFER_TIMEOUT" {
		t.Fatalf("native_timeout_error_class=%s", sx8PerfError(err))
	}
	select {
	case <-tr.acquired:
	default:
		t.Fatal("native_timeout_injection_did_not_reach_publication")
	}
	unchanged, err := s.GetStoredChat(t.Context(), 1, chat.ChatID)
	sx8PerfRequire(t, err, "timeout_rollback_readback")
	if unchanged.Revision != chat.Revision || unchanged.MessageCount != 1 {
		t.Fatal("native_timeout_published_partial_changes")
	}
	retry, err := s.WriteNativeChat(t.Context(), 1, "save", input, intent.ID, manifest, hash, objects)
	sx8PerfRequire(t, err, "native_timeout_same_request_retry")
	if retry.Chat.Revision != chat.Revision+1 || retry.Chat.MessageCount != 1 {
		t.Fatal("native_timeout_retry_lost_data_or_revision")
	}
	t.Log("native_deadline_injection=CHAT_TRANSFER_TIMEOUT rollback_unchanged=true same_request_retry_revision_delta=1")
}

// Reuse the catalog/isolation fixtures but obtain the memory source and claim
// from the actual GO publish path, with no ST snapshot adapter or provider call.
func sx8PerfSetup(t *testing.T) *Store {
	t.Helper()
	s := resetCatalogFixtures(t)
	ctx := t.Context()
	t.Cleanup(func() { s.UseCipher(nil) })
	sx8PerfRequire(t, IsolationSuperExec(ctx, `INSERT INTO vc.model_unit_price(provider_id,model_id,price_version,input_usd_per_1k,output_usd_per_1k) VALUES ('prov-a','model-a',1,0.001,0.002) ON CONFLICT DO NOTHING`), "memory_price_fixture")
	_, err := s.SaveProviderConfig(ctx, 7, SaveProvider{ProviderID: "prov-a", DisplayName: "Synthetic", Protocol: ProtocolOpenAIChat, BaseURL: "https://example.test/v1", Credential: "synthetic", State: ProviderEnabled, Models: []ProviderModel{seedPricedModel("memory", "model-a", intPtr(32768))}})
	sx8PerfRequire(t, err, "memory_provider_fixture")
	_, err = s.SavePurposeBinding(ctx, 7, SavePurposeBinding{Purpose: PurposeMemoryExtraction, ProviderID: "prov-a", ProfileKey: "memory", State: ProviderEnabled})
	sx8PerfRequire(t, err, "memory_purpose_fixture")
	_, err = s.UpdateMemoryAutoSavePref(ctx, 1, true)
	sx8PerfRequire(t, err, "memory_preference_fixture")
	for _, kind := range requiredConsents {
		_, err = s.RecordConsent(ctx, 1, kind, "test", true)
		sx8PerfRequire(t, err, "memory_consent_fixture")
	}
	return s
}
