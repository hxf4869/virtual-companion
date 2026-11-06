//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pause only the final validation transaction, after source reconciliation has
// committed. Match its first statement both before and after the barrier fix.
// No production SQL is replaced, and SQLSTATE survives the store error mapping.
type proposalLockTracer struct {
	once      sync.Once
	ready     chan int32
	resume    chan struct{}
	sqlStates []string // Written by the validation goroutine; read after done.
}

func (tr *proposalLockTracer) TraceQueryStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if data.SQL == `SELECT vc.memory_write_barrier($1)` || strings.Contains(data.SQL, "SELECT EXISTS(SELECT 1 FROM vc.memorycore_scope s JOIN vc.work_item w") {
		tr.once.Do(func() {
			tr.ready <- int32(conn.PgConn().PID())
			select {
			case <-tr.resume:
			case <-ctx.Done():
			}
		})
	}
	return ctx
}

func (tr *proposalLockTracer) TraceQueryEnd(_ context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	var pgErr *pgconn.PgError
	if errors.As(data.Err, &pgErr) {
		tr.sqlStates = append(tr.sqlStates, pgErr.Code)
	}
}

func TestForgetMemoryWhileValidatingEngineProposal(t *testing.T) {
	s, snapshots := engineSampleStore(t)
	ctx := context.Background()
	binding, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "proposal-lock", Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	snapshots[sourceChat] = stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/synthetic/proposal-lock.jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "合成记忆", Eligible: true, Settled: true}}}
	if _, err = s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	jobs, err := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("claim %v: %v", jobs, err)
	}
	job := jobs[0]
	op, err := s.PrepareEngineOperation(ctx, job)
	if err != nil {
		t.Fatal(err)
	}
	memory := addSTMemory(t, binding, "合成记忆", op.SourceRef)
	raw, err := json.Marshal(EngineProposal{Records: []EngineRecord{{ID: "proposal-lock-record", Content: "合成记忆", Version: 1}}, Dependencies: []string{op.SourceKey}})
	if err != nil {
		t.Fatal(err)
	}
	// The ordinary path must still stage successfully, including the nested
	// barrier acquisition in go_memorycore_stage on the same transaction.
	if refs, err := s.ValidateEngineProposal(ctx, job, op, raw); err != nil || !slices.Equal(refs, []string{op.SourceRef}) {
		t.Fatalf("initial validation refs=%v: %v", refs, err)
	}
	var staged, executable bool
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT state='PROPOSED' AND proposal=$2::jsonb,
			       has_function_privilege(current_user,'vc.memory_write_barrier(bigint)','EXECUTE')
			       AND has_function_privilege('vc_api','vc.memory_write_barrier(bigint)','EXECUTE')
			       AND has_function_privilege('vc_worker','vc.memory_write_barrier(bigint)','EXECUTE')
			FROM vc.memorycore_operation WHERE owner_user_id=1 AND job_id=$1`, job.JobID, raw).Scan(&staged, &executable)
	}); err != nil || !staged || !executable {
		t.Fatalf("staged=%t barrier executable=%t: %v", staged, executable, err)
	}

	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tracer := &proposalLockTracer{ready: make(chan int32, 1), resume: make(chan struct{})}
	config := s.pool.Config()
	config.ConnConfig.Tracer = tracer
	pool, err := pgxpool.NewWithConfig(runCtx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	validator := &Store{pool: pool, secret: s.secret, txTimeout: s.txTimeout, stSources: s.stSources}
	done := make(chan struct{})
	var validationErr error
	var refs []string
	t.Cleanup(func() {
		cancel()
		<-done
	})
	go func() {
		defer close(done)
		refs, validationErr = validator.ValidateEngineProposal(runCtx, job, op, raw)
	}()
	var validationPID int32
	select {
	case validationPID = <-tracer.ready:
	case <-done:
		t.Fatalf("validation ended before final transaction: %v (SQLSTATE %v)", validationErr, tracer.sqlStates)
	case <-runCtx.Done():
		t.Fatalf("wait for validation transaction: %v", runCtx.Err())
	}

	var forgotten bool
	forgetErr := s.WithOwner(runCtx, 1, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT vc.memory_write_barrier(1)`); err != nil {
			return err
		}
		ownerPID := int32(tx.Conn().PgConn().PID())
		close(tracer.resume)
		poll := time.NewTicker(10 * time.Millisecond)
		defer poll.Stop()
		for {
			var waiting bool
			err := s.pool.QueryRow(ctx, `
				SELECT EXISTS (
				    SELECT 1 FROM pg_locks held
				    JOIN pg_locks waiter USING (locktype, database, classid, objid, objsubid)
				    WHERE held.pid=$1 AND waiter.pid=$2 AND held.locktype='advisory'
				      AND held.granted AND NOT waiter.granted
				)`, ownerPID, validationPID).Scan(&waiting)
			if err != nil {
				return fmt.Errorf("observe validation barrier wait: %w", err)
			}
			if waiting {
				break
			}
			select {
			case <-done:
				return fmt.Errorf("validation ended before waiting for owner barrier: %v", validationErr)
			case <-ctx.Done():
				return fmt.Errorf("wait for validation at owner barrier: %w", ctx.Err())
			case <-poll.C:
			}
		}
		// Before the fix, validation already holds the source FOR SHARE here,
		// so forgetting closes the source-row/owner-barrier deadlock cycle.
		return tx.QueryRow(ctx, `SELECT vc.memory_forget_begin(1,$1)`, memory.ID).Scan(&forgotten)
	})
	select {
	case <-done:
	case <-runCtx.Done():
		t.Fatalf("wait for validation after forget (forget error %v): %v", forgetErr, runCtx.Err())
	}
	if forgetErr != nil || !forgotten || !errors.Is(validationErr, ErrConflict) || len(tracer.sqlStates) != 0 {
		t.Fatalf("forget=%t error=%v; validation error=%v SQLSTATE=%v", forgotten, forgetErr, validationErr, tracer.sqlStates)
	}
	if !slices.Equal(refs, []string{op.SourceRef}) {
		t.Fatalf("validation dependencies after forget: %v", refs)
	}
	if status, _ := workStatus(t, job.JobID); status != "CANCELLED" {
		t.Fatalf("forgotten source's work item has status %q", status)
	}
	var suppressed, erased bool
	var operationState string
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT src.suppressed,
			       m.value->>'lifecycle'='FORGETTING' AND m.value->>'summary'=''
			       AND m.value->'cleanup'->>'state'='PENDING',
			       op.state
			FROM vc.st_message_source src
			JOIN vc.memorycore_operation op ON (op.owner_user_id,op.source_id)=(src.owner_user_id,src.id)
			CROSS JOIN LATERAL (SELECT vc.memory_management_row(1,$2) AS value) m
			WHERE src.owner_user_id=1 AND op.job_id=$1`, job.JobID, memory.ID).Scan(&suppressed, &erased, &operationState)
	}); err != nil || !suppressed || !erased || operationState != "REVOKED" {
		t.Fatalf("suppressed=%t erased=%t operation=%q: %v", suppressed, erased, operationState, err)
	}
}
