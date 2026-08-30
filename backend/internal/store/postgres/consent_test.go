package postgres

import "testing"

func TestDecideOutboundRequiresEveryNecessaryConsent(t *testing.T) {
	t.Parallel()
	all := []Consent{
		{Type: "SERVICE_TERMS", Granted: true},
		{Type: "PRIVACY_POLICY", Granted: true},
		{Type: "AI_CONTENT_NOTICE", Granted: true},
		{Type: "THIRD_PARTY_MODEL_PROCESSING", Granted: true},
		{Type: "SENSITIVE_DATA_PROCESSING", Granted: true},
	}
	d := DecideOutbound(all, false)
	if !d.Allow || d.Code != "OK" || len(d.Categories) != 3 {
		t.Fatalf("%+v", d)
	}
	withdrawn := append([]Consent{}, all...)
	withdrawn[3].Granted = false
	d = DecideOutbound(withdrawn, false)
	if d.Allow || d.Code != "CONSENT_WITHDRAWN" || len(d.Categories) != 0 {
		t.Fatalf("withdraw %+v", d)
	}
	d = DecideOutbound(all, true)
	if d.Allow || d.Code != "DELETION_IN_PROGRESS" {
		t.Fatalf("delete %+v", d)
	}
	d = DecideOutbound(nil, false)
	if d.Allow {
		t.Fatal("empty consents must fail closed")
	}
}
