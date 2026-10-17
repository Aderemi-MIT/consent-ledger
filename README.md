# ConsentLedger

A permissioned blockchain prototype for **patient consent, provider authorization and tamper-evident access logging** in electronic health record (EHR) sharing between healthcare providers, set in the Nigerian context. Built on **Hyperledger Fabric** as the implementation for a final-year Design Science Research project.

The ledger stores consent and access decisions only, never clinical content. Records stay off-chain in PostgreSQL, and the chain holds references to them plus each accessed record's content hash, so the exact version a provider accessed can be proven later.

> **Synthetic data only.** No real patient information is used or stored anywhere in this project.

## What it does

Five chaincode functions, written in Go:

| Function | Purpose |
|---|---|
| `GrantConsent` | A patient authorizes a provider to access a scope of their records until an expiry date |
| `RevokeConsent` | The patient withdraws that consent early |
| `RequestAccess` | A provider requests a specific off-chain record, recording the SHA-256 of its content (starts as `PENDING`) |
| `VerifyAndGrantAccess` | Checks the request against current, unexpired, non-revoked consent and returns `GRANTED` or `DENIED` |
| `LogAccessEvent` | Appends an audit entry, hash-linked to the previous one so that tampering with any entry is detectable |

Read-only queries: `GetConsent`, `GetRequest`, `GetRequests`, `GetLogEntry`, `GetAuditLog`, `VerifyLogChainIntegrity` and `VerifyAuditLog` (recompute the audit log's hash chain on-chain).

The REST API releases an off-chain record only when its request was `GRANTED`, the consent is still active, and the record's content still matches the hash on the ledger.

## Architecture

```
Web app (web/) ─┐
                ├─HTTP + session cookie─▶ REST API (cmd/api) ──Fabric Gateway (gRPC/TLS)──▶ peer0.org1
Postman ────────┘                              │                                             │
                                               │             chaincode "consentaccess" on mychannel
                                               │             (2 orgs, 1 peer each, CouchDB, Raft orderer)
                                               │
                                               └──SQL──▶ PostgreSQL "offchain_records"
                                                         (synthetic records, accounts, sessions)
```

The chaincode logic (`chaincode.go`) is written against a small `Ledger` interface, so the same functions run on Fabric (through `stub_ledger.go`) and in unit tests (through the in-memory `MockLedger`).

## Accounts and access control

Every route except the `/` health check needs a signed-in account. Accounts live in PostgreSQL ([postgres_auth.sql](chaincode/deployment/postgres_auth.sql)); passwords are bcrypt-hashed by `pgcrypto`, and sessions are random tokens in an HttpOnly cookie (only their SHA-256 is stored), valid for 8 hours. Five failed sign-ins for one username in five minutes are rate-limited.

| Account type | Can |
|---|---|
| Patient | Grant and revoke **their own** consent; see their own records and the requests concerning them |
| Provider (hospital, laboratory, pharmacy, insurer) | Request access **as itself**; verify and open only **its own** requests. The hospital also sees consent status for the records it holds |
| Regulator | Read and verify the whole audit log; see every request, consent and record (metadata only) |

The API enforces these rules on every call; the web app only shows each account the pages it can use. Ten synthetic walkthrough accounts are seeded (five patients, four providers, the regulator); they share one demo password, recorded in `postgres_auth.sql`.

## Repository layout

```
chaincode/
  chaincode.go, types.go   chaincode logic and data model
  ledger.go                Ledger interface + in-memory MockLedger (tests)
  stub_ledger.go           Ledger adapter over Fabric's ChaincodeStub
  contract.go              contractapi SmartContract exposing the functions
  chaincode_test.go        14 unit / functional tests
  cmd/chaincode/           Fabric chaincode entrypoint (package this)
  cmd/api/                 REST API: Fabric Gateway calls (main.go), sign-in and
                           roles (auth.go), off-chain records (records.go),
                           read-only views for the web app (views.go)
  deployment/              deployment notes, Postman collection, Postgres schema,
                           seed data and accounts, live-network evidence files
  test_evidence.md         test results captured during development
  test_evidence_live.md    live-network results: transactions, blocks, tamper test
web/                       React + TypeScript web app (Vite)
```

## Prerequisites

- Docker Desktop (with WSL 2 on Windows)
- Go 1.24+ and Node.js 20+
- Hyperledger Fabric 2.5 samples, binaries and images (`fabric-samples`), with the test network running:

  ```bash
  cd fabric-samples/test-network
  ./network.sh up createChannel -ca
  ```

- PostgreSQL 16 for the off-chain records and accounts, run in Docker with the schema, seed data and accounts loaded: step 5 of [chaincode/deployment/README.md](chaincode/deployment/README.md). Copy `chaincode/deployment/.env.example` to `.env` and set a password first.

## Quick start on Windows

Once everything below is set up, double-click **`scripts\start-consentledger.cmd`** after each restart. It checks free disk space, starts WSL Ubuntu, Docker Desktop, PostgreSQL and the Fabric containers (peers last, retrying the orderer if needed), then the REST API and the web app in their own windows, and opens http://127.0.0.1:5173. Anything already running is left alone. Close the API and web app windows when you're finished.

## Run the tests

```bash
cd chaincode
go test ./...
```

## Deploy the chaincode

The current version is **1.3, sequence 4**. From `fabric-samples/test-network`, with the Org1 Admin environment set (see Fabric's [test network tutorial](https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html)):

```bash
peer lifecycle chaincode package consentaccess.tar.gz --path <repo>/chaincode/cmd/chaincode --lang golang --label consentaccess_1.3
peer lifecycle chaincode install consentaccess.tar.gz          # on peer0.org1 and peer0.org2
peer lifecycle chaincode approveformyorg ... --name consentaccess --version 1.3 --sequence 4 --package-id <id>   # for each org
peer lifecycle chaincode commit ... --name consentaccess --version 1.3 --sequence 4
```

On a fresh network, use sequence 1. Steps 3 and 5 of [chaincode/deployment/README.md](chaincode/deployment/README.md) have more detail.

## Run the REST API

```bash
cd chaincode
set -a; . deployment/.env; set +a      # provides DATABASE_URL
LISTEN_ADDR=:18080 go run ./cmd/api
```

By default it connects to `localhost:7051` as the Org1 Admin, using the crypto material in `~/fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com`. Every setting can be overridden with environment variables, listed at the top of [cmd/api/main.go](chaincode/cmd/api/main.go).

| Method | Route | Body / query |
|---|---|---|
| GET | `/` | Health check (no sign-in): what the API is connected to, whether the chaincode and database answer (200 `ok` or 503) |
| POST | `/auth/login` | `username, password`; sets the session cookie |
| POST | `/auth/logout` | Ends the session |
| GET | `/auth/me` | The signed-in account |
| PUT | `/auth/profile` | `displayName, email, phone` |
| POST | `/auth/password` | `currentPassword, newPassword` (8–72 characters); signs out other sessions |
| POST | `/consent/grant` | `patientId, providerId, scope, expiry` (patient, own consent only) |
| POST | `/consent/revoke` | `patientId, providerId` (patient, own consent only) |
| POST | `/access/request` | `requestId, providerId, patientId, recordReference` (provider, as itself; the record must belong to the patient; its content hash is recorded on the ledger) |
| POST | `/access/verify` | `requestId` (the requesting provider; verifies, then logs the outcome) |
| GET | `/access/requests` | The requests the account may see |
| GET | `/access/status` | `?requestId=...` |
| GET | `/access/log` | `?requestId=...` |
| GET | `/access/record` | `?requestId=...` returns the off-chain record to the requesting provider: 403 if not `GRANTED` or consent revoked/expired, 409 if the record changed since it was requested |
| GET | `/consent` | `?patientId=...&providerId=...` |
| GET | `/directory` | Patients, providers and record metadata the account may see |
| GET | `/audit/log`, `/audit/verify` | The whole audit log and its integrity check (regulator) |

## Run the web app

With the API running on port 18080:

```bash
cd web
npm install
npm run dev -- --host 127.0.0.1
```

Open http://127.0.0.1:5173 and sign in with a walkthrough account. The dev server forwards `/api/...` to the API, so the browser never holds Fabric certificates or database credentials. Each role gets its own pages:

- **Patient**: overview, consent management (allow or revoke each organisation, with a consent history timeline)
- **Laboratory and other providers**: overview, access requests (request, verify, open the record once granted)
- **Hospital**: overview, the records it holds and who can access them, access requests
- **Regulator**: overview, the audit log with a one-click integrity check, records

Every account has **Profile settings** (name, email, phone, change password) and **Switch account** / **Sign out** in the user menu. The search bar finds patients, organisations, records, requests, audit entries and pages that the signed-in account can see.

## Run the end-to-end demo

Import [chaincode/deployment/consentaccess.postman_collection.json](chaincode/deployment/consentaccess.postman_collection.json) into Postman and run the whole collection. It signs in as the patient, the laboratory and the regulator in turn, and every request has assertions. Or, from the command line:

```bash
npx newman@6.2.1 run chaincode/deployment/consentaccess.postman_collection.json
```

## Known limitations

- `VerifyAndGrantAccess` and `LogAccessEvent` are separate transactions, so a failure between them can leave a decision without a log entry.
- The audit log's hash chain uses a single "latest entry" key, so concurrent log writes in the same block conflict and one is rejected.
- Access control is enforced by the API using application accounts; every Fabric transaction is still signed by the Org1 Admin identity. Issuing each user their own Fabric CA identity would move that enforcement onto the network itself.
- A consent's `scope` is recorded but not checked against the requested record's type: any record of the patient can be requested under an active consent.
- `/access/record` checks consent expiry against the API server's clock, since it is a read and has no transaction timestamp.
- The session cookie is not marked `Secure`, because the prototype runs over plain HTTP on localhost; serve it over HTTPS before any wider use.

## Status

- [x] Chaincode logic and unit tests
- [x] Deployed on a two-org Fabric test network
- [x] REST API connected through Fabric Gateway; Postman demo passing on the live network
- [x] PostgreSQL off-chain record store, with record content hashes on the ledger
- [x] Web application with sign-in and role-based access control
- [ ] Usability (TAM) evaluation
