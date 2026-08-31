package postgres

import (
	"reflect"
	"testing"
)

func TestSimulatedVerificationPath(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		state string
		want  []string
		ok    bool
	}{
		{"unknown", AgeUnknown, []string{AgeAdultSelfDeclared, AgeAdultVerificationRequired, AgeAdultVerified}, true},
		{"declared", AgeAdultSelfDeclared, []string{AgeAdultVerificationRequired, AgeAdultVerified}, true},
		{"required", AgeAdultVerificationRequired, []string{AgeAdultVerified}, true},
		{"reverify", AgeReverifyRequired, []string{AgeAdultVerified}, true},
		{"verified is idempotent", AgeAdultVerified, []string{}, true},
		{"suspected minor", AgeMinorSuspected, nil, false},
		{"verified minor", AgeMinorVerified, nil, false},
		{"appeal pending", AgeAppealPending, nil, false},
		{"suspended", AgeAccessSuspended, nil, false},
		{"unknown catalog value", "NOT_A_STATE", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, ok := simulatedVerificationPath(tt.state)
			if ok != tt.ok || !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("path=%v ok=%v, want path=%v ok=%v", got, ok, tt.want, tt.ok)
			}
		})
	}
}
