# ConsentLedger

A permissioned blockchain prototype for **patient consent, provider authorization and tamper-evident access logging** in electronic health record (EHR) sharing between healthcare providers, set in the Nigerian context. Built on **Hyperledger Fabric** as the implementation for a final-year Design Science Research project.

The ledger stores consent and access decisions only, never clinical content: records stay off-chain, and the chain holds references to them.

> **Synthetic data only.** No real patient information is used or stored anywhere in this project.

## What it does

Five chaincode functions, written in Go:

| Function | Purpose |
|---|---|
| `GrantConsent` | A patient authorizes a provider to access a scope of their records until an expiry date |
| `RevokeConsent` | The patient withdraws that consent early |
| `RequestAccess` | A provider requests a specific off-chain record (starts as `PENDING`) |
| `VerifyAndGrantAccess` | Checks the request against current, unexpired, non-revoked consent and returns `GRANTED` or `DENIED` |
| `LogAccessEvent` | Appends an audit entry, hash-linked to the previous one so that tampering with any entry is detectable |

Read-only queries: `GetConsent`, `GetRequest`, `GetLogEntry` and `VerifyLogChainIntegrity` (recomputes the audit log's hash chain on-chain).

## Architecture

```
Postman / web app ──HTTP──▶ REST API (cmd/api) ──Fabric Gateway (gRPC/TLS)──▶ peer0.org1
                                                                                │
                                         chaincode "consentaccess" on mychannel ┤
                                         (2 orgs, 1 peer each, CouchDB, Raft orderer)
```

The chaincode logic (`chaincode.go`) is written against a small `Ledger` interface, so the same functions run on Fabric (through `stub_ledger.go`) and in unit tests (through the in-memory `MockLedger`).

## Repository layout

```
chaincode/
  chaincode.go, types.go   chaincode logic and data model
  ledger.go                Ledger interface + in-memory MockLedger (tests)
  stub_ledger.go           Ledger adapter over Fabric's ChaincodeStub
  contract.go              contractapi SmartContract exposing the functions
  chaincode_test.go        13 unit / functional tests
  cmd/chaincode/           Fabric chaincode entrypoint (package this)
  cmd/api/                 REST API calling the chaincode via Fabric Gateway
  deployment/              deployment notes, Postman collection, Postgres schema,
                           live-network test run (Newman report)
  test_evidence.md         test results captured during development
```

## Prerequisites

- Docker Desktop (with WSL 2 on Windows)
- Go 1.24+
- Hyperledger Fabric 2.5 samples, binaries and images (`fabric-samples`), with the test network running:

  ```bash
  cd fabric-samples/test-network
  ./network.sh up createChannel -ca
  ```

## Run the tests

```bash
cd chaincode
go test ./...
```

## Deploy the chaincode

From `fabric-samples/test-network`, with the Org1 Admin environment set (see Fabric's [test network tutorial](https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html)):

```bash
peer lifecycle chaincode package consentaccess.tar.gz --path <repo>/chaincode/cmd/chaincode --lang golang --label consentaccess_1.0
peer lifecycle chaincode install consentaccess.tar.gz          # on peer0.org1 and peer0.org2
peer lifecycle chaincode approveformyorg ... --name consentaccess --version 1.0 --sequence 1 --package-id <id>   # for each org
peer lifecycle chaincode commit ... --name consentaccess --version 1.0 --sequence 1
```

Step 3 of [chaincode/deployment/README.md](chaincode/deployment/README.md) has more detail.

## Run the REST API

```bash
cd chaincode
LISTEN_ADDR=:18080 go run ./cmd/api
```

By default it connects to `localhost:7051` as the Org1 Admin, using the crypto material in `~/fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com`. Every setting can be overridden with environment variables, listed at the top of [cmd/api/main.go](chaincode/cmd/api/main.go).

| Method | Route | Body / query |
|---|---|---|
| GET | `/` | Status: what the API is connected to, whether the chaincode answers (200 `ok` or 503), and the routes below |
| POST | `/consent/grant` | `patientId, providerId, scope, expiry` |
| POST | `/consent/revoke` | `patientId, providerId` |
| POST | `/access/request` | `requestId, providerId, patientId, recordReference` |
| POST | `/access/verify` | `requestId` (verifies, then logs the outcome) |
| GET | `/access/log` | `?requestId=...` |

## Run the end-to-end demo

Import [chaincode/deployment/consentaccess.postman_collection.json](chaincode/deployment/consentaccess.postman_collection.json) into Postman, set `baseUrl` to `http://localhost:18080`, and run it starting from request 1, which generates fresh request IDs for each run. Or, from the command line:

```bash
npx newman@6.2.1 run chaincode/deployment/consentaccess.postman_collection.json --env-var baseUrl=http://localhost:18080
```

## Known limitations

- `VerifyAndGrantAccess` and `LogAccessEvent` are separate transactions, so a failure between them can leave a decision without a log entry.
- The audit log's hash chain uses a single "latest entry" key, so concurrent log writes in the same block conflict and one is rejected.
- The API signs every transaction as the Org1 Admin. Per-user identities would be needed beyond a prototype.

## Status

- [x] Chaincode logic and unit tests
- [x] Deployed on a two-org Fabric test network
- [x] REST API connected through Fabric Gateway; Postman demo passing on the live network
- [ ] PostgreSQL off-chain record store
- [ ] Web application and usability (TAM) evaluation
