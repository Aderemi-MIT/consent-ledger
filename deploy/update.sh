#!/bin/bash
# Pulls the latest code on the server and rebuilds the API and web app.
# The ledger, database and demo password are left as they are.
#   ./deploy/update.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH=/usr/local/go/bin:/opt/node/bin:$PATH
cd "$REPO"
git pull --ff-only

cd "$REPO/chaincode"
go build -o /tmp/consentaccess-api ./cmd/api
sudo install -m 0755 /tmp/consentaccess-api /usr/local/bin/consentaccess-api
rm /tmp/consentaccess-api
sudo systemctl restart consentledger-api

cd "$REPO/web"
npm ci --no-audit --no-fund
VITE_HIDE_DEMO_ACCOUNTS=true npm run build
sudo rsync -a --delete dist/ /var/www/consentledger/
echo "Updated. API status: $(systemctl is-active consentledger-api)"
