package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestSX8TransferErrorClasses(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code string
		want error
	}{
		{name: "deadline", err: context.DeadlineExceeded, code: "CHAT_TRANSFER_TIMEOUT"},
		{name: "statement", err: &pgconn.PgError{Code: "57014"}, code: "CHAT_TRANSFER_TIMEOUT"},
		{name: "lock", err: &pgconn.PgError{Code: "55P03"}, code: "CHAT_TRANSFER_TIMEOUT"},
		{name: "serialization", err: fmt.Errorf("commit: %w", &pgconn.PgError{Code: "40001"}), code: "REVISION_CONFLICT"},
		{name: "owner", err: ErrOwnerContextRejected, want: ErrOwnerContextRejected},
		{name: "cancel", err: context.Canceled, want: context.Canceled},
		{name: "RLS", err: &pgconn.PgError{Code: "42501"}, want: errStore},
		{name: "uncertain_commit", err: pgx.ErrTxCommitRollback, want: errStore},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapChatTransferErr(context.Background(), tc.err)
			if tc.code != "" {
				var ce *ChatError
				if !errors.As(got, &ce) || ce.Code != tc.code {
					t.Fatalf("got %v want %s", got, tc.code)
				}
			} else if !errors.Is(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(mapChatTransferErr(ctx, errors.New("closed connection")), context.Canceled) {
		t.Fatal("lost cancellation")
	}
	if mapChatTransferErr(ctx, nil) != nil {
		t.Fatal("rewrote successful result")
	}
}

type transferBindingTestTx struct {
	pgx.Tx
	failure error
}

func (tx transferBindingTestTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return transferBindingTestRow{}
}
func (tx transferBindingTestTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, tx.failure
}

type transferBindingTestRow struct{}

func (transferBindingTestRow) Scan(dest ...any) error {
	*dest[0].(*int32) = 1
	*dest[1].(*string) = "1"
	return nil
}
func TestSX8TransferBindingTimeoutPreservesOwnerSentinel(t *testing.T) {
	s := &Store{secret: []byte("synthetic-test-only-binding-secret")}
	for _, code := range []string{"57014", "55P03", "42501"} {
		err := s.bindOwner(context.Background(), transferBindingTestTx{failure: &pgconn.PgError{Code: code}}, 1)
		if !errors.Is(err, ErrOwnerContextRejected) {
			t.Fatal("lost owner rejection sentinel")
		}
		if errors.Is(err, context.DeadlineExceeded) != (code != "42501") {
			t.Fatalf("incorrect timeout for %s", code)
		}
	}
}
