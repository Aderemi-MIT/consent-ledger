package main

// Read-only routes used by the web app (web/): a directory of the synthetic
// patients, providers and records (metadata only, never clinical content)
// from the off-chain store, and lookups of consent, request and audit-log
// state from the ledger.

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	consentaccess "consentaccess"
)

type directoryPatient struct {
	PatientID   string `json:"patientId"`
	DisplayName string `json:"displayName"`
}

type directoryProvider struct {
	ProviderID   string `json:"providerId"`
	Organization string `json:"organization"`
	ProviderType string `json:"providerType"`
}

type directoryRecord struct {
	RecordReference string `json:"recordReference"`
	PatientID       string `json:"patientId"`
	RecordType      string `json:"recordType"`
}

// GET /directory
//
// Providers and the regulator see every patient and record; a patient sees
// only themselves and their own records.
func handleDirectory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	self := ""
	if u := userFrom(r); u.Role == "patient" {
		self = u.PatientID
	}
	out := struct {
		Patients  []directoryPatient  `json:"patients"`
		Providers []directoryProvider `json:"providers"`
		Records   []directoryRecord   `json:"records"`
	}{[]directoryPatient{}, []directoryProvider{}, []directoryRecord{}}

	fail := func(err error) {
		log.Printf("off-chain store query failed: %v", err)
		writeErr(w, http.StatusBadGateway, errors.New("off-chain store unavailable"))
	}
	rows, err := db.Query(ctx, `SELECT patient_id, display_name FROM patients WHERE $1 = '' OR patient_id = $1 ORDER BY patient_id`, self)
	if err != nil {
		fail(err)
		return
	}
	for rows.Next() {
		var p directoryPatient
		if err := rows.Scan(&p.PatientID, &p.DisplayName); err != nil {
			rows.Close()
			fail(err)
			return
		}
		out.Patients = append(out.Patients, p)
	}
	rows.Close()

	rows, err = db.Query(ctx, `SELECT provider_id, organization, provider_type FROM providers ORDER BY provider_id`)
	if err != nil {
		fail(err)
		return
	}
	for rows.Next() {
		var p directoryProvider
		if err := rows.Scan(&p.ProviderID, &p.Organization, &p.ProviderType); err != nil {
			rows.Close()
			fail(err)
			return
		}
		out.Providers = append(out.Providers, p)
	}
	rows.Close()

	rows, err = db.Query(ctx, `SELECT record_reference, patient_id, record_type FROM clinical_records
		WHERE $1 = '' OR patient_id = $1 ORDER BY patient_id, record_reference`, self)
	if err != nil {
		fail(err)
		return
	}
	for rows.Next() {
		var rec directoryRecord
		if err := rows.Scan(&rec.RecordReference, &rec.PatientID, &rec.RecordType); err != nil {
			rows.Close()
			fail(err)
			return
		}
		out.Records = append(out.Records, rec)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		fail(err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// evaluateRaw evaluates a read-only chaincode function and writes its JSON
// result as the response. A chaincode rejection (such as "not found") is
// reported with notFoundStatus.
func evaluateRaw(w http.ResponseWriter, notFoundStatus int, name string, args ...string) {
	b, err := contract.EvaluateTransaction(name, args...)
	if err != nil {
		if msg, ok := chaincodeError(err); ok {
			writeErr(w, notFoundStatus, errors.New(msg))
			return
		}
		writeFabricErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(b))
}

// GET /consent?patientId=...&providerId=...
func handleGetConsent(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !canSeeConsent(userFrom(r), q.Get("patientId"), q.Get("providerId")) {
		forbid(w, "you can only see consent that involves you")
		return
	}
	evaluateRaw(w, http.StatusNotFound, "GetConsent", q.Get("patientId"), q.Get("providerId"))
}

// GET /access/status?requestId=...
func handleGetRequestStatus(w http.ResponseWriter, r *http.Request) {
	ar, ok := lookupRequest(w, r.URL.Query().Get("requestId"))
	if !ok {
		return
	}
	if !canSeeRequest(userFrom(r), ar.ProviderID, ar.PatientID) {
		forbid(w, "you can only see your own requests")
		return
	}
	writeJSON(w, http.StatusOK, ar)
}

// GET /access/requests
//
// Lists the access requests the caller may see, newest first: a provider's
// own requests, the requests concerning a patient, or all of them for the
// regulator.
func handleListRequests(w http.ResponseWriter, r *http.Request) {
	b, err := contract.EvaluateTransaction("GetRequests")
	if err != nil {
		if msg, ok := chaincodeError(err); ok {
			writeErr(w, http.StatusInternalServerError, errors.New(msg))
			return
		}
		writeFabricErr(w, err)
		return
	}
	var all []consentaccess.AccessRequest
	if err := json.Unmarshal(b, &all); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	u := userFrom(r)
	visible := []consentaccess.AccessRequest{}
	for _, ar := range all {
		if canSeeRequest(u, ar.ProviderID, ar.PatientID) {
			visible = append(visible, ar)
		}
	}
	writeJSON(w, http.StatusOK, visible)
}

// GET /audit/log  (regulator only)
func handleAuditLog(w http.ResponseWriter, r *http.Request) {
	if userFrom(r).Role != "regulator" {
		forbid(w, "only the regulator can read the full audit log")
		return
	}
	evaluateRaw(w, http.StatusInternalServerError, "GetAuditLog")
}

// GET /audit/verify  (regulator only)
func handleAuditVerify(w http.ResponseWriter, r *http.Request) {
	if userFrom(r).Role != "regulator" {
		forbid(w, "only the regulator can verify the full audit log")
		return
	}
	evaluateRaw(w, http.StatusInternalServerError, "VerifyAuditLog")
}
