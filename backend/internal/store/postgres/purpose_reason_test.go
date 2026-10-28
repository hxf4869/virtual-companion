package postgres

import "testing"

func TestPurposeUnavailableReason(t *testing.T) {
	window := 32768
	cases := []struct {
		name       string
		bound      bool
		binding    string
		provider   string
		credential bool
		model      string
		context    *int
		purpose    string
		reason     string
		status     string
	}{
		{name: "pending", purpose: PurposeMemoryExtraction, status: BindingPending, reason: PurposeReasonPending},
		{name: "disabled", bound: true, binding: ProviderDisabled, provider: ProviderEnabled, credential: false, model: ProviderEnabled, context: &window, purpose: PurposeMemoryExtraction, status: BindingDisabled, reason: PurposeReasonDisabled},
		{name: "credential", bound: true, binding: ProviderEnabled, provider: ProviderEnabled, model: ProviderEnabled, context: &window, purpose: PurposeMemoryExtraction, status: BindingUnavailable, reason: PurposeReasonCredential},
		{name: "provider", bound: true, binding: ProviderEnabled, provider: ProviderDisabled, credential: true, model: ProviderEnabled, context: &window, purpose: PurposeMemoryExtraction, status: BindingUnavailable, reason: PurposeReasonProvider},
		{name: "model", bound: true, binding: ProviderEnabled, provider: ProviderEnabled, credential: true, model: ProviderDisabled, context: &window, purpose: PurposeMemoryExtraction, status: BindingUnavailable, reason: PurposeReasonModel},
		{name: "context", bound: true, binding: ProviderEnabled, provider: ProviderEnabled, credential: true, model: ProviderEnabled, purpose: PurposeMemoryExtraction, status: BindingUnavailable, reason: PurposeReasonContext},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := purposeUnavailableReason(tc.purpose, tc.binding, tc.bound, tc.provider, tc.credential, tc.model, tc.context); got != tc.reason {
				t.Fatalf("reason %s", got)
			}
			if got := bindingStatus(tc.purpose, tc.binding, tc.bound, tc.provider, tc.credential, tc.model, tc.context); got != tc.status {
				t.Fatalf("status %s", got)
			}
		})
	}
}
