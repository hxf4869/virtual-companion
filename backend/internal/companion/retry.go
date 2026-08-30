package companion

// AllowNewAttempt is the only retry decision. A true result means the
// coordinator may create a new CREATED Attempt; it must never revive the
// current one. G5 exposes the pure decision; G10 owns the job loop.
func AllowNewAttempt(budget TurnBudget, attemptsUsed int, status AttemptStatus, err error) bool {
	if attemptsUsed >= budget.MaxAttempts || budget.MaxAttempts < 1 {
		return false
	}
	if status == AttemptSucceeded || status == AttemptOutcomeUnknown {
		return false
	}
	pe := AsError(err)
	if pe == nil {
		return false
	}
	switch pe.Code {
	case CodeInvalidRequest, CodeCanceled, CodeRateLimited:
		return false
	case CodeDisconnected:
		// DNS/dial failures can use the next route only when the transport can
		// prove that no request bytes left this process.
		return pe.Delivery == DeliveryNotSent && attemptsUsed == 1
	case CodeTimeout:
		if pe.Phase == TimeoutTotal {
			return false
		}
		// Connect failure that never left the process: at most one extra Attempt.
		if pe.Phase == TimeoutConnect && pe.Delivery == DeliveryNotSent {
			return attemptsUsed == 1
		}
		return false
	default:
		return false
	}
}
