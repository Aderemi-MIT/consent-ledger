package consentaccess

import (
	"encoding/json"
	"testing"
	"time"
)

// Fixed reference time so tests are deterministic.
var baseTime = time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

// ---------------------------------------------------------------------
// 1. GrantConsent
// ---------------------------------------------------------------------

func TestGrantConsent_CreatesRecord(t *testing.T) {
	l := NewMockLedger()
	expiry := baseTime.Add(30 * 24 * time.Hour)

	if err := GrantConsent(l, "patient-1", "provider-1", "lab-results", expiry, baseTime); err != nil {
		t.Fatalf("GrantConsent returned unexpected error: %v", err)
	}

	rec, found, err := GetConsent(l, "patient-1", "provider-1")
	if err != nil {
		t.Fatalf("GetConsent error: %v", err)
	}
	if !found {
		t.Fatalf("expected consent record to exist after GrantConsent")
	}
	if rec.Revoked {
		t.Errorf("newly granted consent should not be revoked")
	}
	if !rec.Expiry.Equal(expiry) {
		t.Errorf("expiry mismatch: got %v, want %v", rec.Expiry, expiry)
	}
}

func TestGrantConsent_RejectsPastExpiry(t *testing.T) {
	l := NewMockLedger()
	pastExpiry := baseTime.Add(-1 * time.Hour)

	err := GrantConsent(l, "patient-1", "provider-1", "lab-results", pastExpiry, baseTime)
	if err == nil {
		t.Fatalf("expected an error granting consent with an expiry in the past, got nil")
	}
}

func TestGrantConsent_RejectsMissingIDs(t *testing.T) {
	l := NewMockLedger()
	expiry := baseTime.Add(time.Hour)
	if err := GrantConsent(l, "", "provider-1", "scope", expiry, baseTime); err == nil {
		t.Errorf("expected error for missing patientID")
	}
	if err := GrantConsent(l, "patient-1", "", "scope", expiry, baseTime); err == nil {
		t.Errorf("expected error for missing providerID")
	}
}

// ---------------------------------------------------------------------
// 2. RequestAccess + VerifyAndGrantAccess — the core consent-checking flow
// ---------------------------------------------------------------------

func TestEndToEnd_ValidConsent_RequestIsGranted(t *testing.T) {
	l := NewMockLedger()
	expiry := baseTime.Add(48 * time.Hour)

	mustNoErr(t, GrantConsent(l, "patient-1", "provider-1", "lab-results", expiry, baseTime))
	mustNoErr(t, RequestAccess(l, "req-1", "provider-1", "patient-1", "record-ref-001", baseTime.Add(time.Hour)))

	granted, recordRef, err := VerifyAndGrantAccess(l, "req-1", baseTime.Add(time.Hour))
	if err != nil {
		t.Fatalf("VerifyAndGrantAccess returned unexpected error: %v", err)
	}
	if !granted {
		t.Fatalf("expected access to be granted with valid, unexpired, non-revoked consent")
	}
	if recordRef != "record-ref-001" {
		t.Errorf("expected returned record reference %q, got %q", "record-ref-001", recordRef)
	}

	req, _, _ := GetRequest(l, "req-1")
	if req.Status != StatusGranted {
		t.Errorf("expected request status GRANTED, got %s", req.Status)
	}
}

func TestVerifyAndGrantAccess_NoConsentOnFile_Denied(t *testing.T) {
	l := NewMockLedger()
	mustNoErr(t, RequestAccess(l, "req-2", "provider-1", "patient-1", "record-ref-002", baseTime))

	granted, _, err := VerifyAndGrantAccess(l, "req-2", baseTime)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if granted {
		t.Fatalf("expected access to be denied when no consent record exists")
	}

	req, _, _ := GetRequest(l, "req-2")
	if req.Status != StatusDenied {
		t.Errorf("expected request status DENIED, got %s", req.Status)
	}
}

func TestVerifyAndGrantAccess_ExpiredConsent_Denied(t *testing.T) {
	l := NewMockLedger()
	expiry := baseTime.Add(1 * time.Hour)
	mustNoErr(t, GrantConsent(l, "patient-1", "provider-1", "lab-results", expiry, baseTime))
	mustNoErr(t, RequestAccess(l, "req-3", "provider-1", "patient-1", "record-ref-003", baseTime))

	// Request is verified two hours later, after the consent's expiry.
	afterExpiry := baseTime.Add(2 * time.Hour)
	granted, _, err := VerifyAndGrantAccess(l, "req-3", afterExpiry)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if granted {
		t.Fatalf("expected access to be denied once consent has expired")
	}
}

func TestVerifyAndGrantAccess_UnknownRequest_Errors(t *testing.T) {
	l := NewMockLedger()
	_, _, err := VerifyAndGrantAccess(l, "does-not-exist", baseTime)
	if err == nil {
		t.Fatalf("expected an error verifying a request ID that was never submitted")
	}
}

func TestRequestAccess_DuplicateRequestID_Rejected(t *testing.T) {
	l := NewMockLedger()
	mustNoErr(t, RequestAccess(l, "req-dup", "provider-1", "patient-1", "ref", baseTime))
	if err := RequestAccess(l, "req-dup", "provider-1", "patient-1", "ref", baseTime); err == nil {
		t.Fatalf("expected an error submitting a request with a requestID that already exists")
	}
}

// ---------------------------------------------------------------------
// 3. RevokeConsent — auto-denial of subsequent requests (Figure 3.2)
// ---------------------------------------------------------------------

func TestRevokeConsent_SubsequentRequestIsAutoDenied(t *testing.T) {
	l := NewMockLedger()
	expiry := baseTime.Add(72 * time.Hour)
	mustNoErr(t, GrantConsent(l, "patient-1", "provider-1", "lab-results", expiry, baseTime))

	// First request, before revocation: should be granted.
	mustNoErr(t, RequestAccess(l, "req-before-revoke", "provider-1", "patient-1", "ref-1", baseTime.Add(time.Hour)))
	granted, _, err := VerifyAndGrantAccess(l, "req-before-revoke", baseTime.Add(time.Hour))
	mustNoErr(t, err)
	if !granted {
		t.Fatalf("expected request before revocation to be granted")
	}

	// Patient revokes consent.
	mustNoErr(t, RevokeConsent(l, "patient-1", "provider-1"))

	// Second request, after revocation but still before the original expiry: should be denied.
	mustNoErr(t, RequestAccess(l, "req-after-revoke", "provider-1", "patient-1", "ref-2", baseTime.Add(2*time.Hour)))
	granted, _, err = VerifyAndGrantAccess(l, "req-after-revoke", baseTime.Add(2*time.Hour))
	mustNoErr(t, err)
	if granted {
		t.Fatalf("expected request after revocation to be auto-denied, even though the original expiry had not passed")
	}
}

func TestRevokeConsent_UnknownConsent_Errors(t *testing.T) {
	l := NewMockLedger()
	if err := RevokeConsent(l, "patient-x", "provider-x"); err == nil {
		t.Fatalf("expected an error revoking a consent record that was never granted")
	}
}

// ---------------------------------------------------------------------
// 4. LogAccessEvent + VerifyLogChainIntegrity — tamper-evidence (Section 3.7)
// ---------------------------------------------------------------------

func TestLogAccessEvent_RecordsOutcome(t *testing.T) {
	l := NewMockLedger()
	mustNoErr(t, LogAccessEvent(l, "req-1", string(StatusGranted), baseTime))

	entry, found, err := GetLogEntry(l, "req-1")
	mustNoErr(t, err)
	if !found {
		t.Fatalf("expected a log entry to exist after LogAccessEvent")
	}
	if entry.Outcome != string(StatusGranted) {
		t.Errorf("expected outcome %q, got %q", StatusGranted, entry.Outcome)
	}
	if entry.Seq != 1 || entry.PrevHash != "" {
		t.Errorf("expected the first log entry to be seq=1 with empty PrevHash, got seq=%d prevHash=%q", entry.Seq, entry.PrevHash)
	}
}

func TestVerifyLogChainIntegrity_IntactChain_PassesVerification(t *testing.T) {
	l := NewMockLedger()
	mustNoErr(t, LogAccessEvent(l, "req-1", "GRANTED", baseTime))
	mustNoErr(t, LogAccessEvent(l, "req-2", "DENIED", baseTime.Add(time.Minute)))
	mustNoErr(t, LogAccessEvent(l, "req-3", "GRANTED", baseTime.Add(2*time.Minute)))

	intact, brokenAt, err := VerifyLogChainIntegrity(l, []string{"req-1", "req-2", "req-3"})
	mustNoErr(t, err)
	if !intact {
		t.Fatalf("expected an untampered log chain to verify as intact, broke at %q", brokenAt)
	}
}

func TestVerifyLogChainIntegrity_DetectsDirectTamperingWithHistoricalEntry(t *testing.T) {
	l := NewMockLedger()
	mustNoErr(t, LogAccessEvent(l, "req-1", "GRANTED", baseTime))
	mustNoErr(t, LogAccessEvent(l, "req-2", "DENIED", baseTime.Add(time.Minute)))
	mustNoErr(t, LogAccessEvent(l, "req-3", "GRANTED", baseTime.Add(2*time.Minute)))

	// Simulate an attacker (or faulty node) altering a historical entry
	// directly in a test copy of the ledger, exactly as planned in Section
	// 3.7's tamper-evidence test: req-2's outcome is flipped from DENIED to
	// GRANTED without going through LogAccessEvent, so its stored Hash no
	// longer matches what its fields now hash to.
	entry, found, err := GetLogEntry(l, "req-2")
	mustNoErr(t, err)
	if !found {
		t.Fatalf("expected req-2 log entry to exist before tampering")
	}
	entry.Outcome = "GRANTED" // tampered value
	tamperedBytes, err := json.Marshal(entry)
	mustNoErr(t, err)
	l.PutState(logKey("req-2"), tamperedBytes)

	intact, brokenAt, err := VerifyLogChainIntegrity(l, []string{"req-1", "req-2", "req-3"})
	mustNoErr(t, err)
	if intact {
		t.Fatalf("expected tampering with req-2's outcome to be detected, but chain verified as intact")
	}
	if brokenAt != "req-2" {
		t.Errorf("expected tampering to be reported at req-2, got %q", brokenAt)
	}
}

// ---------------------------------------------------------------------
// test helpers
// ---------------------------------------------------------------------

func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
