package main

// Off-chain record access (Section 3.4.4). Clinical records live only in
// PostgreSQL (deployment/postgres_schema.sql); the ledger holds each
// request's record reference and the SHA-256 of the record's content.
// The API reads the hash from PostgreSQL when a provider requests a record
// and records it on the ledger, then releases the record only if the
// request was GRANTED, the patient's consent is still active, and the
// record's current content still hashes to the value on the ledger.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	consentaccess "consentaccess"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

// contentHashSQL is how a record's content hash is defined: the SHA-256
// (lowercase hex) of PostgreSQL's canonical JSONB text form. It matches the
// content_hash computed by deployment/postgres_seed.sql. It is always
// recomputed from the content rather than read from the content_hash
// column, so an edit to the content cannot be hidden by also editing the
// stored hash.
const contentHashSQL = `encode(sha256(convert_to(content::text, 'UTF8')), 'hex')`

var errRecordNotFound = errors.New("record not found")

// recordHash returns the owning patient and current content hash of an
// off-chain record.
func recordHash(ctx context.Context, recordReference string) (patientID, contentHash string, err error) {
	err = db.QueryRow(ctx,
		`SELECT patient_id, `+contentHashSQL+` FROM clinical_records WHERE record_reference = $1`,
		recordReference).Scan(&patientID, &contentHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", errRecordNotFound
	}
	return patientID, contentHash, err
}

// evaluateJSON evaluates a read-only chaincode function and decodes its
// JSON result into v.
func evaluateJSON(name string, v interface{}, args ...string) error {
	b, err := contract.EvaluateTransaction(name, args...)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// GET /access/record?requestId=...
//
// Returns the off-chain record behind a GRANTED request. Refuses with 403
// if the request was not granted or the consent has since been revoked or
// has expired, and with 409 if the record's content no longer matches the
// hash recorded on the ledger when access was requested.
func handleGetRecord(w http.ResponseWriter, r *http.Request) {
	requestID := r.URL.Query().Get("requestId")

	var req consentaccess.AccessRequest
	if err := evaluateJSON("GetRequest", &req, requestID); err != nil {
		if msg, ok := chaincodeError(err); ok {
			writeErr(w, http.StatusNotFound, errors.New(msg))
			return
		}
		writeFabricErr(w, err)
		return
	}
	if u := userFrom(r); u.Role != "provider" || u.ProviderID != req.ProviderID {
		forbid(w, "only the provider that made a request can open its record")
		return
	}
	if req.Status != consentaccess.StatusGranted {
		writeErr(w, http.StatusForbidden, fmt.Errorf("access was not granted for request %s (status %s)", requestID, req.Status))
		return
	}

	var consent consentaccess.ConsentRecord
	if err := evaluateJSON("GetConsent", &consent, req.PatientID, req.ProviderID); err != nil {
		if msg, ok := chaincodeError(err); ok {
			writeErr(w, http.StatusForbidden, errors.New(msg))
			return
		}
		writeFabricErr(w, err)
		return
	}
	if consent.Revoked {
		writeErr(w, http.StatusForbidden, fmt.Errorf("consent for patient %s / provider %s has been revoked", req.PatientID, req.ProviderID))
		return
	}
	if !consent.Expiry.After(time.Now()) {
		writeErr(w, http.StatusForbidden, fmt.Errorf("consent for patient %s / provider %s has expired", req.PatientID, req.ProviderID))
		return
	}
	if req.ContentHash == "" {
		writeErr(w, http.StatusConflict, fmt.Errorf("request %s has no content hash on the ledger (it predates chaincode v1.1)", requestID))
		return
	}

	var (
		recordType, content, currentHash string
	)
	err := db.QueryRow(r.Context(),
		`SELECT record_type, content::text, `+contentHashSQL+` FROM clinical_records WHERE record_reference = $1`,
		req.RecordReference).Scan(&recordType, &content, &currentHash)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, fmt.Errorf("record %s not found in the off-chain store", req.RecordReference))
		return
	}
	if err != nil {
		log.Printf("off-chain store query failed: %v", err)
		writeErr(w, http.StatusBadGateway, errors.New("off-chain store unavailable"))
		return
	}
	if currentHash != req.ContentHash {
		log.Printf("record %s changed since request %s: off-chain hash %s, ledger hash %s", req.RecordReference, requestID, currentHash, req.ContentHash)
		writeErr(w, http.StatusConflict, fmt.Errorf("record %s has changed since access was requested: its content hash %s does not match the hash %s recorded on the ledger", req.RecordReference, currentHash, req.ContentHash))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"requestId":       requestID,
		"recordReference": req.RecordReference,
		"patientId":       req.PatientID,
		"recordType":      recordType,
		"content":         json.RawMessage(content),
		"contentHash":     currentHash,
		"hashVerified":    true,
	})
}
