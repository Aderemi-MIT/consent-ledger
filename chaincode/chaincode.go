// Package consentaccess implements the five chaincode functions described
// in Section 3.4.3 of the dissertation (Smart Contract / Chaincode Design):
// GrantConsent, RevokeConsent, RequestAccess, VerifyAndGrantAccess, and
// LogAccessEvent. Consistent with the narrowed scope defined in Section 1.4,
// none of these functions reads or writes clinical content directly — all
// of them operate only on consent state, access-request state, and the
// audit log, mirroring the on-chain/off-chain split in Section 3.4.4.
//
// The functions are written against the Ledger interface (ledger.go) rather
// than directly against Hyperledger Fabric's shim.ChaincodeStubInterface,
// so that the same logic that will run inside the Fabric peer once deployed
// can be exercised here with MockLedger, a plain in-memory stand-in for the
// Fabric world state. This lets the chaincode logic be genuinely unit- and
// functional-tested in this environment, which cannot provision the Fabric
// test network's Docker containers.
package consentaccess

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// GrantConsent records a patient's authorization for a named provider to
// access a defined category of information, valid until a specified expiry.
func GrantConsent(l Ledger, patientID, providerID, scope string, expiry time.Time, now time.Time) error {
	if patientID == "" || providerID == "" {
		return fmt.Errorf("patientID and providerID are required")
	}
	if !expiry.After(now) {
		return fmt.Errorf("expiry must be in the future")
	}
	rec := ConsentRecord{
		PatientID:  patientID,
		ProviderID: providerID,
		Scope:      scope,
		Expiry:     expiry,
		Revoked:    false,
		GrantedAt:  now,
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	l.PutState(consentKey(patientID, providerID), b)
	return nil
}

// RevokeConsent invalidates a previously granted consent record before its
// expiry. Any subsequent request referencing that consent is denied
// automatically (enforced in VerifyAndGrantAccess).
func RevokeConsent(l Ledger, patientID, providerID string) error {
	key := consentKey(patientID, providerID)
	b, ok := l.GetState(key)
	if !ok {
		return fmt.Errorf("no consent record found for patient %s / provider %s", patientID, providerID)
	}
	var rec ConsentRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		return err
	}
	rec.Revoked = true
	nb, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	l.PutState(key, nb)
	return nil
}

// isSHA256Hex reports whether s is a lowercase hex-encoded SHA-256 digest.
func isSHA256Hex(s string) bool {
	if len(s) != sha256.Size*2 {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// RequestAccess logs a provider's request to access a specific off-chain
// record reference, together with the SHA-256 hash of that record's content
// as the application layer read it from the off-chain store. The request
// starts in PENDING status until VerifyAndGrantAccess resolves it. The hash
// is what lets the record later be proven to be the exact version accessed
// (Section 3.4.4): the record itself never reaches the ledger.
func RequestAccess(l Ledger, requestID, providerID, patientID, recordReference, contentHash string, now time.Time) error {
	if requestID == "" {
		return fmt.Errorf("requestID is required")
	}
	if !isSHA256Hex(contentHash) {
		return fmt.Errorf("contentHash must be a lowercase hex SHA-256 digest")
	}
	if _, exists := l.GetState(requestKey(requestID)); exists {
		return fmt.Errorf("request %s already exists", requestID)
	}
	req := AccessRequest{
		RequestID:       requestID,
		ProviderID:      providerID,
		PatientID:       patientID,
		RecordReference: recordReference,
		ContentHash:     contentHash,
		Status:          StatusPending,
		RequestedAt:     now,
	}
	b, err := json.Marshal(req)
	if err != nil {
		return err
	}
	l.PutState(requestKey(requestID), b)
	return nil
}

// VerifyAndGrantAccess checks an access request against the current,
// unexpired, non-revoked consent record before returning an access token
// (here, the stored record reference) or a denial. Requests that fail
// verification are logged as denied rather than silently dropped — the
// caller is expected to follow this with LogAccessEvent, matching the
// process flow in Section 3.4.5 / Figure 3.2.
func VerifyAndGrantAccess(l Ledger, requestID string, now time.Time) (granted bool, recordReference string, err error) {
	rb, ok := l.GetState(requestKey(requestID))
	if !ok {
		return false, "", fmt.Errorf("request %s not found", requestID)
	}
	var req AccessRequest
	if err := json.Unmarshal(rb, &req); err != nil {
		return false, "", err
	}

	cb, ok := l.GetState(consentKey(req.PatientID, req.ProviderID))
	allowed := false
	if ok {
		var rec ConsentRecord
		if err := json.Unmarshal(cb, &rec); err != nil {
			return false, "", err
		}
		if !rec.Revoked && rec.Expiry.After(now) {
			allowed = true
		}
	}

	if allowed {
		req.Status = StatusGranted
	} else {
		req.Status = StatusDenied
	}
	nb, err := json.Marshal(req)
	if err != nil {
		return false, "", err
	}
	l.PutState(requestKey(requestID), nb)

	if allowed {
		return true, req.RecordReference, nil
	}
	return false, "", nil
}

// computeEntryHash hashes an entry's fields together with the previous
// entry's hash, so that altering any field of any historical entry changes
// its hash and breaks the chain for every entry appended after it — the
// same block-linking principle illustrated in Figure 2.6, applied per log
// entry.
func computeEntryHash(seq int, requestID, outcome string, loggedAt time.Time, prevHash string) string {
	h := sha256.New()
	fmt.Fprintf(h, "%d|%s|%s|%s|%s", seq, requestID, outcome, loggedAt.UTC().Format(time.RFC3339Nano), prevHash)
	return hex.EncodeToString(h.Sum(nil))
}

// LogAccessEvent appends an immutable entry recording who requested access,
// when, to what, and with what outcome, forming the audit trail referenced
// in Section 3.3 / 3.4.3(v). Each entry is hash-linked to the one before it
// (logChainHeadKey tracks the running head), so the log as a whole can be
// verified with VerifyLogChainIntegrity.
func LogAccessEvent(l Ledger, requestID, outcome string, now time.Time) error {
	if requestID == "" {
		return fmt.Errorf("requestID is required")
	}

	seq := 1
	prevHash := ""
	if hb, ok := l.GetState(logChainHeadKey); ok {
		var head logChainHead
		if err := json.Unmarshal(hb, &head); err != nil {
			return err
		}
		seq = head.Seq + 1
		prevHash = head.Hash
	}

	hash := computeEntryHash(seq, requestID, outcome, now, prevHash)
	entry := AccessLogEntry{
		RequestID: requestID,
		Outcome:   outcome,
		LoggedAt:  now,
		Seq:       seq,
		PrevHash:  prevHash,
		Hash:      hash,
	}
	b, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	l.PutState(logKey(requestID), b)

	headB, err := json.Marshal(logChainHead{Seq: seq, Hash: hash})
	if err != nil {
		return err
	}
	l.PutState(logChainHeadKey, headB)
	return nil
}

// VerifyLogChainIntegrity recomputes the hash chain over the given log
// entries (in the order they were originally appended) and confirms every
// entry's stored hash still matches what its (possibly since-altered)
// fields hash to, and that each entry's PrevHash still matches the previous
// entry's recomputed hash. It returns the requestID of the first entry
// found to be inconsistent, if any — this is the test used in Section 3.7's
// tamper-evidence evaluation: a log entry is altered directly in a test
// copy of the ledger, and this function confirms the alteration is
// detectable.
func VerifyLogChainIntegrity(l Ledger, requestIDsInOrder []string) (intact bool, brokenAt string, err error) {
	prevHash := ""
	for i, rid := range requestIDsInOrder {
		entry, ok, gerr := GetLogEntry(l, rid)
		if gerr != nil {
			return false, rid, gerr
		}
		if !ok {
			return false, rid, fmt.Errorf("log entry for request %s not found", rid)
		}
		expectedHash := computeEntryHash(i+1, entry.RequestID, entry.Outcome, entry.LoggedAt, prevHash)
		if entry.PrevHash != prevHash || entry.Hash != expectedHash {
			return false, rid, nil
		}
		prevHash = entry.Hash
	}
	return true, "", nil
}

// GetConsent is a small read helper used by the tests (and, in a deployed
// network, by the application layer) to inspect current consent state.
func GetConsent(l Ledger, patientID, providerID string) (ConsentRecord, bool, error) {
	b, ok := l.GetState(consentKey(patientID, providerID))
	if !ok {
		return ConsentRecord{}, false, nil
	}
	var rec ConsentRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		return ConsentRecord{}, false, err
	}
	return rec, true, nil
}

// GetRequest is a small read helper used by the tests to inspect current
// request state.
func GetRequest(l Ledger, requestID string) (AccessRequest, bool, error) {
	b, ok := l.GetState(requestKey(requestID))
	if !ok {
		return AccessRequest{}, false, nil
	}
	var req AccessRequest
	if err := json.Unmarshal(b, &req); err != nil {
		return AccessRequest{}, false, err
	}
	return req, true, nil
}

// GetLogEntry is a small read helper used by the tests to inspect the audit
// log written by LogAccessEvent.
func GetLogEntry(l Ledger, requestID string) (AccessLogEntry, bool, error) {
	b, ok := l.GetState(logKey(requestID))
	if !ok {
		return AccessLogEntry{}, false, nil
	}
	var entry AccessLogEntry
	if err := json.Unmarshal(b, &entry); err != nil {
		return AccessLogEntry{}, false, err
	}
	return entry, true, nil
}
