#!/bin/bash
# Sets up the hosted ConsentLedger demo on a fresh Ubuntu 22.04 server
# (Oracle Cloud Always Free ARM VM, or any arm64/amd64 Ubuntu 22.04 VM).
#
#   git clone https://github.com/The-Net-Savvy/consentledger.git
#   cd consentledger
#   ./deploy/server-setup.sh consentledger.duckdns.org
#
# The domain must already point at this server's public IP, and ports 80
# and 443 must be open in the cloud firewall (see deploy/HOSTING.md).
# Run as the normal login user (ubuntu), not root; it calls sudo itself.
# Safe to re-run: each step skips work that is already done.
#
# What it does:
#   1. opens ports 80/443 in the server's own firewall
#   2. installs Docker, Go, Node.js, jq and the Fabric 2.5.16 binaries/images
#   3. brings up the Fabric test network and deploys chaincode v1.3
#   4. starts PostgreSQL, loads the schema, seed data and accounts, and sets
#      a new demo password for the walkthrough accounts
#   5. builds the API and runs it as a systemd service (auto-restarts)
#   6. builds the web app and serves it over HTTPS with Caddy
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>   e.g. $0 consentledger.duckdns.org" >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then
  echo "Run this as your normal user (e.g. ubuntu), not root." >&2
  exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
FABRIC_VERSION=2.5.16
CA_VERSION=1.5.17
GO_VERSION=1.24.7
NODE_VERSION=22.12.0
CC_VERSION=1.3
FABRIC_HOME="$HOME/fabric"
TEST_NETWORK="$FABRIC_HOME/fabric-samples/test-network"
WEB_ROOT=/var/www/consentledger
API_BIN=/usr/local/bin/consentaccess-api
ENV_FILE="$REPO/chaincode/deployment/.env"

case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 ;;
  x86_64) ARCH=amd64 ;;
  *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac
NODE_ARCH=$([ "$ARCH" = amd64 ] && echo x64 || echo arm64)

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
export PATH=/usr/local/go/bin:/opt/node/bin:$FABRIC_HOME/fabric-samples/bin:$PATH

# ---------------------------------------------------------------------------
step "1/6 Server firewall: allow HTTP and HTTPS"
# Oracle's Ubuntu images ship iptables rules that reject everything except
# SSH. Insert ACCEPT rules for 80/443 ahead of that REJECT, live and in the
# saved rules file (edited directly so Docker's own chains are never saved).
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    pos=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
    sudo iptables -I INPUT "${pos:-1}" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  fi
  rules=/etc/iptables/rules.v4
  if [ -f "$rules" ] && ! sudo grep -q -- "--dport $port -j ACCEPT" "$rules"; then
    sudo sed -i "0,/^-A INPUT .*REJECT/s//-A INPUT -p tcp -m state --state NEW -m tcp --dport $port -j ACCEPT\n&/" "$rules"
  fi
done

# ---------------------------------------------------------------------------
step "2/6 Installing Docker, Go $GO_VERSION, Node.js $NODE_VERSION, jq and Fabric $FABRIC_VERSION"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2 jq curl git rsync
  sudo systemctl enable --now docker
fi
if ! id -nG | grep -qw docker; then
  sudo usermod -aG docker "$USER"
fi
if ! docker info >/dev/null 2>&1; then
  # The new docker group membership applies to new logins; re-run this
  # script under it instead of asking the user to log out and back in.
  echo "Re-running with Docker group permissions..."
  exec sg docker -c "$(printf '%q ' "$0" "$@")"
fi

# Containers on the Fabric network publish ports (CouchDB, peers, orderer).
# Block new connections to them from outside; the API reaches them locally.
EXT_IF=$(ip route show default | awk '{print $5; exit}')
sudo tee /etc/systemd/system/consentledger-docker-firewall.service >/dev/null <<EOF
[Unit]
Description=Block outside access to ConsentLedger container ports
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -i $EXT_IF -m conntrack --ctstate NEW -j DROP 2>/dev/null || iptables -I DOCKER-USER -i $EXT_IF -m conntrack --ctstate NEW -j DROP'

[Install]
WantedBy=docker.service
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now consentledger-docker-firewall.service

if ! /usr/local/go/bin/go version 2>/dev/null | grep -q "go$GO_VERSION "; then
  curl -fsSL "https://go.dev/dl/go$GO_VERSION.linux-$ARCH.tar.gz" -o /tmp/go.tgz
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf /tmp/go.tgz
  rm /tmp/go.tgz
fi
if ! /opt/node/bin/node --version 2>/dev/null | grep -q "v$NODE_VERSION"; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz" -o /tmp/node.txz
  sudo rm -rf /opt/node
  sudo mkdir -p /opt/node
  sudo tar -C /opt/node --strip-components=1 -xJf /tmp/node.txz
  rm /tmp/node.txz
fi
if [ ! -x "$FABRIC_HOME/fabric-samples/bin/peer" ]; then
  mkdir -p "$FABRIC_HOME"
  cd "$FABRIC_HOME"
  curl -fsSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
  chmod +x install-fabric.sh
  ./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" docker samples binary
fi

# ---------------------------------------------------------------------------
step "3/6 Fabric network and chaincode consentaccess v$CC_VERSION"
cd "$TEST_NETWORK"
if ! docker ps --format '{{.Names}}' | grep -qx peer0.org1.example.com; then
  if docker ps -a --format '{{.Names}}' | grep -qx peer0.org1.example.com; then
    # Containers exist from an earlier run: start them rather than wiping
    # the ledger.
    docker start ca_org1 ca_org2 ca_orderer couchdb0 couchdb1 orderer.example.com
    docker start peer0.org1.example.com peer0.org2.example.com
  else
    ./network.sh up createChannel -c mychannel -ca -s couchdb
  fi
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
  # Installing builds the Go chaincode inside fabric-ccenv and can take
  # several minutes per peer on a small VM.
  ./network.sh deployCC -c mychannel -ccn consentaccess \
    -ccp "$REPO/chaincode/cmd/chaincode" -ccl go -ccv "$CC_VERSION" -ccs 1
fi
# Restart the Fabric containers automatically after a reboot. Ledger data
# lives in Docker volumes, so it survives.
docker update --restart unless-stopped \
  ca_org1 ca_org2 ca_orderer couchdb0 couchdb1 orderer.example.com \
  peer0.org1.example.com peer0.org2.example.com >/dev/null

# ---------------------------------------------------------------------------
step "4/6 PostgreSQL off-chain store and walkthrough accounts"
if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  umask 077
  cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgres://consentaccess:$DB_PASSWORD@localhost:5433/offchain_records
EOF
  umask 022
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
  # The public server must not use the demo password published in the
  # repository. Generate a new one for all walkthrough accounts.
  DEMO_PASSWORD="${DEMO_PASSWORD:-Ledger-$(openssl rand -hex 3)-$(date +%Y)}"
  echo "UPDATE app_users SET password_hash = crypt(:'pw', gen_salt('bf', 10));" |
    psql_db -v pw="$DEMO_PASSWORD"
  umask 077
  printf '%s\n' "$DEMO_PASSWORD" >"$HOME/consentledger-demo-password.txt"
  umask 022
  NEW_PASSWORD_SET=1
fi

# ---------------------------------------------------------------------------
step "5/6 REST API service"
cd "$REPO/chaincode"
go build -o /tmp/consentaccess-api ./cmd/api
sudo install -m 0755 /tmp/consentaccess-api "$API_BIN"
rm /tmp/consentaccess-api
sudo tee /etc/systemd/system/consentledger-api.service >/dev/null <<EOF
[Unit]
Description=ConsentLedger REST API
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
User=$USER
EnvironmentFile=$ENV_FILE
Environment=LISTEN_ADDR=127.0.0.1:18080
Environment=COOKIE_SECURE=true
Environment=FABRIC_ORG1_DIR=$TEST_NETWORK/organizations/peerOrganizations/org1.example.com
ExecStart=$API_BIN
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable consentledger-api.service
sudo systemctl restart consentledger-api.service

# ---------------------------------------------------------------------------
step "6/6 Web app over HTTPS (Caddy)"
cd "$REPO/web"
npm ci --no-audit --no-fund
VITE_HIDE_DEMO_ACCOUNTS=true npm run build
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete dist/ "$WEB_ROOT/"
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt |
    sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y caddy
fi
sed "s/{\$DOMAIN}/$DOMAIN/" "$REPO/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
sudo systemctl enable caddy
sudo systemctl reload caddy || sudo systemctl restart caddy

# ---------------------------------------------------------------------------
step "Checking the deployment"
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:18080/ >/dev/null 2>&1 && break
  sleep 2
done
if curl -fsS http://127.0.0.1:18080/ >/dev/null 2>&1; then
  echo "API: running"
else
  echo "API: not answering yet. See: sudo journalctl -u consentledger-api -n 50" >&2
fi
echo
echo "ConsentLedger is set up at https://$DOMAIN"
echo "(the HTTPS certificate can take a minute to issue on first visit)."
if [ "${NEW_PASSWORD_SET:-}" = 1 ]; then
  echo
  echo "A new password was set for all ten walkthrough accounts and saved to"
  echo "  $HOME/consentledger-demo-password.txt"
  echo "Show it with: cat ~/consentledger-demo-password.txt"
fi
