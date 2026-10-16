package consentaccess

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// SmartContract exposes the five chaincode functions in chaincode.go as
// Fabric transactions. Each method is a thin wrapper: it builds a
// stubLedger over the transaction's stub, takes "now" from the
// transaction timestamp, calls the existing function, and surfaces any
// error the stub reported.
//
// The transaction timestamp is used instead of time.Now() because every
// endorsing peer must compute identical results: the timestamp is set by
// the submitting client and is the same on every peer, whereas each
// peer's clock is not.
//
// contractapi registers every exported method on SmartContract as a
// transaction, so shared helpers below are plain unexported functions.
type SmartContract struct {
	contractapi.Contract
}

// VerifyResult is the response of VerifyAndGrantAccess. RecordReference is
// empty when access is denied.
type VerifyResult struct {
	Granted         bool   `json:"granted"`
	RecordReference string `json:"recordReference"`
}

func txContext(ctx contractapi.TransactionContextInterface) (*stubLedger, time.Time, error) {
	stub := ctx.GetStub()
	ts, err := stub.GetTxTimestamp()
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("reading transaction timestamp: %w", err)
	}
	return newStubLedger(stub), ts.AsTime(), nil
}

// finish returns the function's own error if it failed, otherwise any
// error the stub reported while it ran.
func finish(l *stubLedger, err error) error {
	if err != nil {
		return err
	}
	return l.err
}

// GrantConsent records a patient's consent for a provider. expiry is an
// RFC 3339 timestamp, e.g. "2026-12-31T23:59:59Z".
func (s *SmartContract) GrantConsent(ctx contractapi.TransactionContextInterface, patientID, providerID, scope, expiry string) error {
	exp, err := time.Parse(time.RFC3339, expiry)
	if err != nil {
		return fmt.Errorf("expiry must be an RFC 3339 timestamp: %w", err)
	}
	l, now, err := txContext(ctx)
	if err != nil {
		return err
	}
	return finish(l, GrantConsent(l, patientID, providerID, scope, exp, now))
}

// RevokeConsent revokes a previously granted consent.
func (s *SmartContract) RevokeConsent(ctx contractapi.TransactionContextInterface, patientID, providerID string) error {
	l, _, err := txContext(ctx)
	if err != nil {
		return err
	}
	return finish(l, RevokeConsent(l, patientID, providerID))
}

// RequestAccess records a provider's PENDING request for a record, with the
// SHA-256 (hex) of the record's off-chain content.
func (s *SmartContract) RequestAccess(ctx contractapi.TransactionContextInterface, requestID, providerID, patientID, recordReference, contentHash string) error {
	l, now, err := txContext(ctx)
	if err != nil {
		return err
	}
	return finish(l, RequestAccess(l, requestID, providerID, patientID, recordReference, contentHash, now))
}

// VerifyAndGrantAccess resolves a pending request against current consent.
func (s *SmartContract) VerifyAndGrantAccess(ctx contractapi.TransactionContextInterface, requestID string) (*VerifyResult, error) {
	l, now, err := txContext(ctx)
	if err != nil {
		return nil, err
	}
	granted, ref, err := VerifyAndGrantAccess(l, requestID, now)
	if err := finish(l, err); err != nil {
		return nil, err
	}
	return &VerifyResult{Granted: granted, RecordReference: ref}, nil
}

// LogAccessEvent appends a hash-linked audit entry for a request.
func (s *SmartContract) LogAccessEvent(ctx contractapi.TransactionContextInterface, requestID, outcome string) error {
	l, now, err := txContext(ctx)
	if err != nil {
		return err
	}
	return finish(l, LogAccessEvent(l, requestID, outcome, now))
}

// The methods below are read-only queries. Clients should call them with
// evaluate (not submit), so they run on a single peer and are never
// ordered into a block.

// GetConsent returns the consent record for a patient/provider pair.
func (s *SmartContract) GetConsent(ctx contractapi.TransactionContextInterface, patientID, providerID string) (*ConsentRecord, error) {
	l := newStubLedger(ctx.GetStub())
	rec, found, err := GetConsent(l, patientID, providerID)
	if err := finish(l, err); err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("no consent record found for patient %s / provider %s", patientID, providerID)
	}
	return &rec, nil
}

// GetRequest returns an access request and its current status.
func (s *SmartContract) GetRequest(ctx contractapi.TransactionContextInterface, requestID string) (*AccessRequest, error) {
	l := newStubLedger(ctx.GetStub())
	req, found, err := GetRequest(l, requestID)
	if err := finish(l, err); err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("request %s not found", requestID)
	}
	return &req, nil
}

// GetLogEntry returns the audit log entry written for a request.
func (s *SmartContract) GetLogEntry(ctx contractapi.TransactionContextInterface, requestID string) (*AccessLogEntry, error) {
	l := newStubLedger(ctx.GetStub())
	entry, found, err := GetLogEntry(l, requestID)
	if err := finish(l, err); err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("log entry for request %s not found", requestID)
	}
	return &entry, nil
}

// IntegrityResult is the response of VerifyLogChainIntegrity. BrokenAt is
// the requestID of the first inconsistent entry, empty when intact.
type IntegrityResult struct {
	Intact   bool   `json:"intact"`
	BrokenAt string `json:"brokenAt"`
}

// GetRequests returns every access request, newest first. The API filters
// the list to what the caller may see.
func (s *SmartContract) GetRequests(ctx contractapi.TransactionContextInterface) ([]*AccessRequest, error) {
	// Every request key is "REQUEST|" + requestID; '}' is the byte after
	// '|', so ["REQUEST|", "REQUEST}") covers exactly those keys.
	it, err := ctx.GetStub().GetStateByRange(requestKey(""), "REQUEST}")
	if err != nil {
		return nil, err
	}
	defer it.Close()
	reqs := []*AccessRequest{}
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, err
		}
		var r AccessRequest
		if err := json.Unmarshal(kv.Value, &r); err != nil {
			return nil, fmt.Errorf("decoding request %s: %w", kv.Key, err)
		}
		reqs = append(reqs, &r)
	}
	sort.Slice(reqs, func(i, j int) bool { return reqs[i].RequestedAt.After(reqs[j].RequestedAt) })
	return reqs, nil
}

// GetAuditLog returns every audit log entry, ordered by sequence number.
func (s *SmartContract) GetAuditLog(ctx contractapi.TransactionContextInterface) ([]*AccessLogEntry, error) {
	// Every log key is "LOG|" + requestID. '}' is the byte after '|', so
	// ["LOG|", "LOG}") covers exactly the keys starting with "LOG|".
	it, err := ctx.GetStub().GetStateByRange(logKey(""), "LOG}")
	if err != nil {
		return nil, err
	}
	defer it.Close()
	entries := []*AccessLogEntry{}
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, err
		}
		var e AccessLogEntry
		if err := json.Unmarshal(kv.Value, &e); err != nil {
			return nil, fmt.Errorf("decoding log entry %s: %w", kv.Key, err)
		}
		entries = append(entries, &e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Seq < entries[j].Seq })
	return entries, nil
}

// VerifyAuditLog checks the whole audit log's hash chain, taking the order
// of entries from their sequence numbers on the ledger.
func (s *SmartContract) VerifyAuditLog(ctx contractapi.TransactionContextInterface) (*IntegrityResult, error) {
	entries, err := s.GetAuditLog(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.RequestID
	}
	return s.VerifyLogChainIntegrity(ctx, ids)
}

// VerifyLogChainIntegrity recomputes the audit log's hash chain over the
// given request IDs, in the order their log entries were appended.
func (s *SmartContract) VerifyLogChainIntegrity(ctx contractapi.TransactionContextInterface, requestIDsInOrder []string) (*IntegrityResult, error) {
	l := newStubLedger(ctx.GetStub())
	intact, brokenAt, err := VerifyLogChainIntegrity(l, requestIDsInOrder)
	if err := finish(l, err); err != nil {
		return nil, err
	}
	return &IntegrityResult{Intact: intact, BrokenAt: brokenAt}, nil
}
