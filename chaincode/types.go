package consentaccess

import "time"

// ConsentRecord is the on-chain representation of a patient's authorization
// for a named provider to access a defined category of information, as
// described in Section 3.4.4 (Data Design) of the dissertation.
type ConsentRecord struct {
	PatientID  string    `json:"patientId"`
	ProviderID string    `json:"providerId"`
	Scope      string    `json:"scope"`
	Expiry     time.Time `json:"expiry"`
	Revoked    bool      `json:"revoked"`
	GrantedAt  time.Time `json:"grantedAt"`
}

// RequestStatus enumerates the lifecycle states of an AccessRequest.
type RequestStatus string

const (
	StatusPending RequestStatus = "PENDING"
	StatusGranted RequestStatus = "GRANTED"
	StatusDenied  RequestStatus = "DENIED"
)

// AccessRequest is the on-chain record of a provider's request to access a
// specific off-chain record reference.
type AccessRequest struct {
	RequestID       string        `json:"requestId"`
	ProviderID      string        `json:"providerId"`
	PatientID       string        `json:"patientId"`
	RecordReference string        `json:"recordReference"`
	Status          RequestStatus `json:"status"`
	RequestedAt     time.Time     `json:"requestedAt"`
}

// AccessLogEntry is the immutable audit-trail entry written by
// LogAccessEvent, recording who requested access, when, to what, and with
// what outcome (Section 3.4.3(v)). PrevHash/Hash implement the same
// hash-linking principle described for block structure in Section 2.1.6 /
// Figure 2.6, applied here at the level of individual log entries so that
// tampering with any one historical entry is detectable, matching the
// tamper-evidence test planned in Section 3.7.
type AccessLogEntry struct {
	RequestID string    `json:"requestId"`
	Outcome   string    `json:"outcome"`
	LoggedAt  time.Time `json:"loggedAt"`
	Seq       int       `json:"seq"`
	PrevHash  string    `json:"prevHash"`
	Hash      string    `json:"hash"`
}

func consentKey(patientID, providerID string) string {
	return "CONSENT|" + patientID + "|" + providerID
}

func requestKey(requestID string) string {
	return "REQUEST|" + requestID
}

func logKey(requestID string) string {
	return "LOG|" + requestID
}

// logChainHeadKey stores the hash and sequence number of the most recently
// appended log entry, so the next LogAccessEvent call can chain onto it.
const logChainHeadKey = "LOGCHAIN_HEAD"

type logChainHead struct {
	Seq  int    `json:"seq"`
	Hash string `json:"hash"`
}
