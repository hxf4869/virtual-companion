package memorycore

import "testing"
import "time"

func TestDeadLetterWaitCoversMeasuredThinkingTail(t *testing.T) {
	const measuredP95 = 9482 * time.Millisecond
	const censoredTimeout = 10071 * time.Millisecond
	if ExtractFirstToken < measuredP95 || ExtractFirstToken < censoredTimeout {
		t.Fatalf("attempt window %s does not cover thinking-max p95 %s or censored timeout %s", ExtractFirstToken, measuredP95, censoredTimeout)
	}
	if 3*ExtractFirstToken < measuredP95 {
		t.Fatal("dead-letter wait is shorter than the measured tail")
	}
}
