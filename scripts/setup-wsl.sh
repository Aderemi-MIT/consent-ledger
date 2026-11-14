#!/bin/bash
# First-time setup of ConsentLedger inside WSL Ubuntu on a new Windows PC.
# setup-new-pc.ps1 runs this; it can also be run by hand from Ubuntu:
#   bash scripts/setup-wsl.sh
# It installs Go and the Fabric 2.5.16 binaries and images, brings up the
# Fabric test network, deploys chaincode consentaccess v1.3, and starts
# PostgreSQL with the schema, seed data and walkthrough accounts.
# Safe to re-run: each step skips work that is already done.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
FABRIC_VERSION=2.5.16
CA_VERSION=1.5.17
GO_VERSION=1.24.7
CC_VERSION=1.3
FABRIC_HOME="$HOME/fabric"
TEST_NETWORK="$FABRIC_HOME/fabric-samples/test-network"
ENV_FILE="$REPO/chaincode/deployment/.env"
export PATH=/usr/local/go/bin:$FABRIC_HOME/fabric-samples/bin:$PATH

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "1/5 Checking Docker"
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not reachable from Ubuntu. In Docker Desktop open Settings >" >&2
  echo "Resources > WSL integration, turn on Ubuntu-22.04, click Apply & restart," >&2
  echo "then run this again." >&2
  exit 1
fi
echo "Docker is available."

step "2/5 Installing tools (jq, Go $GO_VERSION, Fabric $FABRIC_VERSION)"
if ! command -v jq >/dev/null || ! command -v git >/dev/null; then
  echo "Ubuntu may ask for your Linux password to install packages."
  sudo apt-get update
  sudo apt-get install -y jq curl git
fi
# Install Go only when it is missing or older than the version go.mod needs;
# a newer Go already on the PC is left alone.
have_go=$(/usr/local/go/bin/go env GOVERSION 2>/dev/null | sed 's/^go//' || true)
oldest=$(printf '%s\n' "$GO_VERSION" "$have_go" | sort -V | head -1)
if [ -z "$have_go" ] || [ "$oldest" != "$GO_VERSION" ]; then
  curl -fsSL "https://go.dev/dl/go$GO_VERSION.linux-amd64.tar.gz" -o /tmp/go.tgz
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf /tmp/go.tgz
  rm /tmp/go.tgz
fi
go version
if [ ! -x "$FABRIC_HOME/fabric-samples/bin/peer" ]; then
  mkdir -p "$FABRIC_HOME"
  cd "$FABRIC_HOME"
  curl -fsSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
  chmod +x install-fabric.sh
  ./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" docker samples binary
fi
peer version | grep Version

step "3/5 Fabric network and chaincode consentaccess v$CC_VERSION"
cd "$TEST_NETWORK"
if docker ps -a --format '{{.Names}}' | grep -qx peer0.org1.example.com; then
  echo "The Fabric network already exists; starting its containers."
  docker start ca_org1 ca_org2 ca_orderer couchdb0 couchdb1 >/dev/null
  docker start orderer.example.com >/dev/null
  sleep 5
  docker start peer0.org1.example.com peer0.org2.example.com >/dev/null
else
  ./network.sh up createChannel -c mychannel -ca -s couchdb
fi
export FABRIC_CFG_PATH="$FABRIC_HOME/fabric-samples/config"
export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem"
export CORE_PEER_MSPCONFIGPATH="$TEST_NETWORK/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS=localhost:7051
for i in $(seq 1 30); do
  peer channel list 2>/dev/null | grep -qx mychannel && break
  sleep 2
done
if peer lifecycle chaincode querycommitted -C mychannel -n consentaccess >/dev/null 2>&1; then
  echo "consentaccess is already committed on mychannel."
else
  # Installing builds the Go chaincode inside fabric-ccenv: allow several
  # minutes per peer.
  ./network.sh deployCC -c mychannel -ccn consentaccess \
    -ccp "$REPO/chaincode/cmd/chaincode" -ccl go -ccv "$CC_VERSION" -ccs 1
fi

step "4/5 PostgreSQL off-chain store and walkthrough accounts"
if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgres://consentaccess:$DB_PASSWORD@localhost:5433/offchain_records
EOF
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "Created chaincode/deployment/.env with a new database password."
fi
set -a
. "$ENV_FILE"
set +a
psql_db() { docker exec -i consentledger-db psql -v ON_ERROR_STOP=1 -q -U consentaccess -d offchain_records "$@"; }
if ! docker ps -a --format '{{.Names}}' | grep -qx consentledger-db; then
  docker run -d --name consentledger-db --restart unless-stopped \
    -e POSTGRES_DB=offchain_records -e POSTGRES_USER=consentaccess \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -p 127.0.0.1:5433:5432 -v consentledger-pgdata:/var/lib/postgresql/data \
    postgres:16.4-alpine >/dev/null
fi
docker start consentledger-db >/dev/null
for i in $(seq 1 30); do
  docker exec consentledger-db pg_isready -U consentaccess -d offchain_records >/dev/null 2>&1 && break
  sleep 2
done
if [ "$(psql_db -tAc "SELECT to_regclass('app_users') IS NOT NULL")" != t ]; then
  psql_db <"$REPO/chaincode/deployment/postgres_schema.sql"
  psql_db <"$REPO/chaincode/deployment/postgres_seed.sql"
  psql_db <"$REPO/chaincode/deployment/postgres_auth.sql"
  echo "Loaded the schema, synthetic records and the ten walkthrough accounts."
else
  echo "The database is already loaded."
fi

step "5/5 Building and testing the chaincode and API"
cd "$REPO/chaincode"
go test ./... 2>&1 | tail -3
go build -o "$HOME/consentaccess-api" ./cmd/api
echo "The API builds."

echo
echo "Setup inside Ubuntu is complete."
