#!/bin/bash
# Builds and runs the ConsentLedger REST API (chaincode/cmd/api) on port
# 18080, with DATABASE_URL from chaincode/deployment/.env. Run inside WSL
# Ubuntu; start-consentledger.ps1 calls it. Stop it with Ctrl+C.
set -euo pipefail
export PATH=/usr/local/go/bin:$PATH
cd "$(dirname "$0")/../chaincode"

if [ ! -f deployment/.env ]; then
  echo "Missing chaincode/deployment/.env (copy .env.example and set the database password)." >&2
  exit 1
fi
set -a
. deployment/.env
set +a

BIN="$HOME/consentaccess-api"
echo "Building the API..."
go build -o "$BIN" ./cmd/api
echo "Starting the API on ${LISTEN_ADDR:-:18080}"
LISTEN_ADDR="${LISTEN_ADDR:-:18080}" exec "$BIN"
