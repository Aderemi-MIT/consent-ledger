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

Read-only queries: `GetConsent`, `GetRequest`, `GetLogEntry` and `VerifyLogChainIntegrity` (recomputes the audit log's hash chain on-chain).

The REST API releases an off-chain record only when its request was `GRANTED`, the consent is still active, and the record's content still matches the hash on the ledger.

## Architecture

```
Postman / web app ──HTTP──▶ REST API (cmd/api) ──Fabric Gateway (gRPC/TLS)──▶ peer0.org1
                                   │                                             │
                                   │             chaincode "consentaccess" on mychannel
                                   │             (2 orgs, 1 peer each, CouchDB, Raft orderer)
                                   │
                                   └──SQL──▶ PostgreSQL "offchain_records" (synthetic records)
```

The chaincode logic (`chaincode.go`) is written against a small `Ledger` interface, so the same functions run on Fabric (through `stub_ledger.go`) and in unit tests (through the in-memory `MockLedger`).

## Repository layout

```
chaincode/
  chaincode.go, types.go   chaincode logic and data model
  ledger.go                Ledger interface + in-memory MockLedger (tests)
  stub_ledger.go           Ledger adapter over Fabric's ChaincodeStub
  contract.go              contractapi SmartContract exposing the functions
  chaincode_test.go        14 unit / functional tests
  cmd/chaincode/           Fabric chaincode entrypoint (package this)
  cmd/api/                 REST API: Fabric Gateway calls (main.go) and
                           off-chain record access (records.go)
  deployment/              deployment notes, Postman collection, Postgres schema
                           and synthetic seed data, live-network evidence files
  test_evidence.md         test results captured during development
  test_evidence_live.md    live-network results: transactions, blocks, tamper test
```

## Prerequisites

- Docker Desktop (with WSL 2 on Windows)
- Go 1.24+
- Hyperledger Fabric 2.5 samples, binaries and images (`fabric-samples`), with the test network running:

  ```bash
  cd fabric-samples/test-network
  ./network.sh up createChannel -ca
  ```

- PostgreSQL 16 for the off-chain records, run in Docker with the schema and seed data loaded: step 5 of [chaincode/deployment/README.md](chaincode/deployment/README.md). Copy `chaincode/deployment/.env.example` to `.env` and set a password first.

## Run the tests

```bash
cd chaincode
go test ./...
```

## Deploy the chaincode

The current version is **1.1, sequence 2**. From `fabric-samples/test-network`, with the Org1 Admin environment set (see Fabric's [test network tutorial](https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html)):

```bash
peer lifecycle chaincode package consentaccess.tar.gz --path <repo>/chaincode/cmd/chaincode --lang golang --label consentaccess_1.1
peer lifecycle chaincode install consentaccess.tar.gz          # on peer0.org1 and peer0.org2
peer lifecycle chaincode approveformyorg ... --name consentaccess --version 1.1 --sequence 2 --package-id <id>   # for each org
peer lifecycle chaincode commit ... --name consentaccess --version 1.1 --sequence 2
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
| GET | `/` | Status: what the API is connected to, whether the chaincode and database answer (200 `ok` or 503), and the routes below |
| POST | `/consent/grant` | `patientId, providerId, scope, expiry` |
| POST | `/consent/revoke` | `patientId, providerId` |
| POST | `/access/request` | `requestId, providerId, patientId, recordReference` (the record must exist and belong to the patient; its content hash is recorded on the ledger) |
| POST | `/access/verify` | `requestId` (verifies, then logs the outcome) |
| GET | `/access/log` | `?requestId=...` |
| GET | `/access/record` | `?requestId=...` returns the off-chain record: 403 if not `GRANTED` or consent revoked/expired, 409 if the record changed since it was requested |

## Run the end-to-end demo

Import [chaincode/deployment/consentaccess.postman_collection.json](chaincode/deployment/consentaccess.postman_collection.json) into Postman, set `baseUrl` to `http://localhost:18080`, and run it starting from request 1, which generates fresh request IDs for each run. Or, from the command line:

```bash
npx newman@6.2.1 run chaincode/deployment/consentaccess.postman_collection.json --env-var baseUrl=http://localhost:18080
```

## Known limitations

- `VerifyAndGrantAccess` and `LogAccessEvent` are separate transactions, so a failure between them can leave a decision without a log entry.
- The audit log's hash chain uses a single "latest entry" key, so concurrent log writes in the same block conflict and one is rejected.
- The API signs every transaction as the Org1 Admin. Per-user identities would be needed beyond a prototype.
- A consent's `scope` is recorded but not checked against the requested record's type: any record of the patient can be requested under an active consent.
- `/access/record` checks consent expiry against the API server's clock, since it is a read and has no transaction timestamp.

## Status

- [x] Chaincode logic and unit tests
- [x] Deployed on a two-org Fabric test network
- [x] REST API connected through Fabric Gateway; Postman demo passing on the live network
- [x] PostgreSQL off-chain record store, with record content hashes on the ledger (chaincode v1.1)
- [ ] Web application and usability (TAM) evaluation
