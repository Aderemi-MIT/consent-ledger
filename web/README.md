# ConsentLedger web app

React + TypeScript (Vite) front end for the ConsentLedger prototype: sign-in,
patient consent management, access requests, hospital records and the
regulator's audit log. It talks only to the REST API in `chaincode/cmd/api`,
which the dev server proxies at `/api`.

```bash
npm install
npm run dev -- --host 127.0.0.1    # http://127.0.0.1:5173, API on :18080
npm run build                       # type-check and production build
npm run lint
```

See the main [README](../README.md) for accounts, roles and how to run the
API and network.
