# Test Evidence — Consent-and-Access-Control Chaincode Logic

Captured 2026-10-01 from this environment. All output below is real, reproducible
console output from `go test` and a live local run of the REST wrapper
(`cmd/api`) — nothing here is simulated or invented.

## 1. Unit and functional test results

Command: `go test ./... -v -cover`

13 of 13 tests passed. Statement coverage: 82.0%.

| # | Test | Scenario | Result |
|---|------|----------|--------|
| 1 | TestGrantConsent_CreatesRecord | Patient grants consent; record exists, not revoked, correct expiry | PASS |
| 2 | TestGrantConsent_RejectsPastExpiry | Consent with an expiry in the past is rejected | PASS |
| 3 | TestGrantConsent_RejectsMissingIDs | Missing patientID / providerID rejected | PASS |
| 4 | TestEndToEnd_ValidConsent_RequestIsGranted | Grant → request → verify, with valid consent → GRANTED, correct record reference returned | PASS |
| 5 | TestVerifyAndGrantAccess_NoConsentOnFile_Denied | Request with no consent on file → DENIED, not an error | PASS |
| 6 | TestVerifyAndGrantAccess_ExpiredConsent_Denied | Request verified after the consent's expiry → DENIED | PASS |
| 7 | TestVerifyAndGrantAccess_UnknownRequest_Errors | Verifying a requestID that was never submitted → error | PASS |
| 8 | TestRequestAccess_DuplicateRequestID_Rejected | Re-using a requestID is rejected | PASS |
| 9 | TestRevokeConsent_SubsequentRequestIsAutoDenied | Grant → request (GRANTED) → revoke → new request → auto-DENIED, even before original expiry | PASS |
| 10 | TestRevokeConsent_UnknownConsent_Errors | Revoking a consent that was never granted → error | PASS |
| 11 | TestLogAccessEvent_RecordsOutcome | Log entry created with correct outcome, seq=1, empty PrevHash | PASS |
| 12 | TestVerifyLogChainIntegrity_IntactChain_PassesVerification | Untampered 3-entry log chain verifies as intact | PASS |
| 13 | TestVerifyLogChainIntegrity_DetectsDirectTamperingWithHistoricalEntry | Outcome of a historical entry altered directly in the ledger → verification detects the break at the correct entry | PASS |

Raw console output: see `test_output.txt` in the same directory.

## 2. Live end-to-end demonstration (REST wrapper over the chaincode logic)

The chaincode logic was also exercised live over HTTP, via `cmd/api`
(`go run ./cmd/api`), standing in for calls the application layer will make
into the Fabric network once deployed. Server log:

```
2026/10/01 07:01:34 consent-access API listening on :8080 (backed by in-memory ledger)
```

Request/response transcript (`curl`, verbatim):

1. **Grant consent** — patient-002 authorizes provider-lab-B for `full-record` until 2026-12-31.
   `POST /consent/grant` → `{"status":"consent granted"}`

2. **Provider submits access request** `req-1001` for `ehr-ref-55A`.
   `POST /access/request` → `{"status":"access requested"}`

3. **Verify and grant access** for `req-1001`.
   `POST /access/verify` → `{"granted":true,"outcome":"GRANTED","recordReference":"ehr-ref-55A"}`

4. **Audit log entry** for `req-1001`.
   `GET /access/log?requestId=req-1001` →
   `{"requestId":"req-1001","outcome":"GRANTED","loggedAt":"2026-10-01T07:01:58.340579164Z","seq":1,"prevHash":"","hash":"22fc39da02524a3d611cf486b699841423dafcc85895b53d81848c10400547ea"}`

5. **Patient revokes consent.**
   `POST /consent/revoke` → `{"status":"consent revoked"}`

6. **Same provider submits a new request** `req-1002` for the same record.
   `POST /access/request` → `{"status":"access requested"}`

7. **Verify `req-1002`** — consent was revoked, so this must be denied even though the original expiry (2026-12-31) has not passed.
   `POST /access/verify` → `{"granted":false,"outcome":"DENIED","recordReference":""}`

8. **Audit log entry for `req-1002`** — note `prevHash` equals entry 1's `hash`, demonstrating the hash chain linking log entries together.
   `GET /access/log?requestId=req-1002` →
   `{"requestId":"req-1002","outcome":"DENIED","loggedAt":"2026-10-01T07:01:58.384495263Z","seq":2,"prevHash":"22fc39da02524a3d611cf486b699841423dafcc85895b53d81848c10400547ea","hash":"45f0fbe97b6da9b3b09a269ed85997e3ced3d6f4d637d111edd988edf841b57c"}`

9. **Verify a request ID that was never submitted** (error-handling check).
   `POST /access/verify` with `requestId: does-not-exist` → HTTP 400,
   `{"error":"request does-not-exist not found"}`

## 3. What this evidence does and does not cover

This demonstrates the chaincode's business logic — consent granting, revocation,
request verification, auto-denial after revoke, and hash-chained audit
logging with tamper detection — running correctly and being genuinely
exercised, both via Go's testing framework and over a live local HTTP
server. It does **not** involve a running Hyperledger Fabric network
(orderer, peers, certificate authorities): provisioning that network's
Docker containers is outside what this environment can run. The same
functions in `chaincode.go` are written against the `Ledger` interface
specifically so that deploying them inside the real Fabric chaincode shim
(swapping `MockLedger` for `shim.ChaincodeStubInterface`) requires no change
to the logic itself — only the deployment step, described in the
accompanying `deployment/` materials, remains to be run on a Docker-enabled
machine.
