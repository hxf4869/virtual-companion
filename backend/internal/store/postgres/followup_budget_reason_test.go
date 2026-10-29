package postgres

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestFollowUpLimitsAndCeilingShareBudgetReason(t *testing.T) {
	for _, msg := range []string{
		"model cost limits are not configured",
		"model cost reservation ceiling is too small",
	} {
		err := mapFollowUpGenErr(&pgconn.PgError{Code: "P0001", Message: msg})
		var usage *ModelUsageError
		if !errors.Is(err, ErrFollowUpBudget) || !errors.As(err, &usage) || usage.Reason != ModelUsageNoBudget {
			t.Fatalf("%s -> %v", msg, err)
		}
	}
	err := mapFollowUpGenErr(&pgconn.PgError{Code: "P0001", Message: "monthly cost hard cap exceeded"})
	var usage *ModelUsageError
	if !errors.Is(err, ErrFollowUpBudget) || errors.As(err, &usage) {
		t.Fatalf("hard cap -> %v", err)
	}
}
