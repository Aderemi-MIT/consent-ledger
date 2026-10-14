# Deployment materials — to be run on a Docker-enabled machine

Everything in `chaincode/` (the Go logic, its unit tests, and the REST
wrapper in `cmd/api`) was written and genuinely executed in a cloud sandbox
with no Docker daemon available. The materials in this folder are what's
needed to take that same logic onto a real Hyperledger Fabric network. None
of these steps have been run yet — they are the remaining work, to be
carried out on a machine with Docker Desktop (or Docker Engine) installed,
before the live network screenshots and the usability survey can be
captured for the dissertation.

## Steps

1. **Install prerequisites**: Docker, Docker Compose, and the Hyperledger
   Fabric samples/binaries (`curl -sSL https://bit.ly/2ysbOFE | bash -s`,
   the official Fabric bootstrap script, or `fabric-samples` cloned from
   GitHub).

2. **Bring up the Fabric test network.** Hyperledger Fabric's own
   `fabric-samples/test-network/network.sh` script is the standard,
   supported way to stand up a two-organization permissioned network
   (orderer, peer0.org1, peer0.org2, a CA per organization, CouchDB per
   peer) — Section 3.5 of the dissertation describes the prototype as using
   this test-network configuration rather than a hand-built one, which is
   consistent with how Fabric projects are normally bootstrapped. The
   `docker-compose.reference.yml` in this folder documents the container
   topology that script brings up, for anyone reading the dissertation who
   wants to see the pieces without installing Fabric.

   ```
   ./network.sh up createChannel -ca
   ```

3. **Package and install the chaincode.** The logic in `../chaincode.go`,
   `../types.go`, and `../ledger.go` runs on Fabric through `../stub_ledger.go`,
   an adapter that satisfies the same `Ledger` interface as `MockLedger` using
   the real `shim.ChaincodeStubInterface`. `../contract.go` exposes it as a
   `contractapi` contract, and `../cmd/chaincode` is its entry point, so that
   is the path to package (run from this folder). Package and install per
   Fabric's usual flow:

   ```
   peer lifecycle chaincode package consentaccess.tar.gz --path ../cmd/chaincode --lang golang --label consentaccess_1
   peer lifecycle chaincode install consentaccess.tar.gz
   peer lifecycle chaincode approveformyorg ...
   peer lifecycle chaincode commit ...
   ```

4. **Point the REST wrapper (`cmd/api`) at the Fabric Gateway** instead of
   `MockLedger`, using the Fabric Gateway Go client SDK to submit/evaluate
   transactions against the committed chaincode. The HTTP routes and
   request/response shapes stay exactly as already tested in
   `test_evidence.md` — only the backing ledger changes.

5. **Set up PostgreSQL** for the off-chain layer using `postgres_schema.sql`
   in this folder, and seed it with synthetic patient/clinical records per
   Section 1.4's narrowed scope (synthetic data only, never real patient
   data).

6. **Re-run the Postman collection** (`consentaccess.postman_collection.json`)
   against the live network and capture the responses/screenshots — this
   replaces the local-only transcript in `test_evidence.md` with live-network
   evidence for Chapter 4's final version.

7. **Run the TAM usability walkthrough** (Section 3.7) with a small group of
   prospective users against the running application layer, and record the
   structured questionnaire responses.
