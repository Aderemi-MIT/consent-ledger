# Hosting ConsentLedger online (Oracle Cloud Always Free)

This puts the whole prototype (the Fabric network, PostgreSQL, the REST API and
the web app) on one free cloud server, reachable at an HTTPS address that
questionnaire participants can open from any browser.

| Part | Who | Time |
|---|---|---|
| A. Create the Oracle Cloud account | you | 20–40 min (plus card check) |
| B. Create the server (VM) | you, following the steps | 15 min |
| C. Open ports 80 and 443 in Oracle's firewall | you, following the steps | 5 min |
| D. Get a free web address (DuckDNS) | you | 5 min |
| E. Run the setup script on the server | the script | 30–60 min, mostly waiting |
| F. Check it works and share the link | you | 10 min |

## A. Oracle Cloud account

1. Go to <https://www.oracle.com/cloud/free/> and choose **Start for free**.
2. Use your real name and an address that matches your debit/credit card.
   Oracle places a small temporary hold to verify the card; Always Free
   resources are not charged.
3. **Home region**: choose one close to Nigeria with Ampere (ARM) capacity,
   such as **South Africa Central (Johannesburg)** or **UK South (London)**.
   It cannot be changed later.
4. If the card is declined, stop here and say so: the alternatives are Azure
   for Students or a small paid VM, and the setup script works on those too.

## B. Create the server

In the Oracle Cloud console: **Menu → Compute → Instances → Create instance**.

1. **Name**: `consentledger`.
2. **Image and shape → Edit**:
   - Image: **Canonical Ubuntu 22.04** (not "Minimal").
   - Shape: **Ampere → VM.Standard.A1.Flex**, **4 OCPUs, 24 GB memory**
     (the Always Free limit).
3. **Networking**: keep the defaults (a new virtual cloud network with a
   public subnet) and make sure **Assign a public IPv4 address** is on.
4. **Add SSH keys**: choose **Generate a key pair for me** and click
   **Save private key**. Keep that file (for example
   `C:\Users\user\.ssh\consentledger.key`); without it you cannot log in.
5. **Boot volume**: the default (about 47 GB) is enough.
6. Click **Create**. When the instance shows **Running**, copy its
   **Public IP address**.

If Oracle says *Out of capacity for shape VM.Standard.A1.Flex*, try again
later, pick another availability domain, or temporarily use 2 OCPUs / 12 GB.

## C. Open ports 80 and 443 in Oracle's firewall

On the instance page: **Subnet → Security lists → Default security list →
Add ingress rules**, and add two rules:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Do not open any other ports. (The server's own firewall is opened by the
setup script.)

## D. Free web address (DuckDNS)

1. Go to <https://www.duckdns.org> and sign in (Google or GitHub).
2. Add a subdomain, for example `consentledger` →
   `consentledger.duckdns.org`.
3. In the **current ip** box, paste the server's public IP and click
   **update ip**.

## E. Run the setup script

From Windows PowerShell on your PC (use your key path and IP):

```
ssh -i C:\Users\user\.ssh\consentledger.key ubuntu@<public-ip>
```

Answer `yes` the first time. If SSH complains that the key's permissions are
too open, run this once in PowerShell and try again:

```
icacls C:\Users\user\.ssh\consentledger.key /inheritance:r /grant:r "$($env:USERNAME):R"
```

Then, on the server:

```
git clone https://github.com/The-Net-Savvy/consentledger.git
cd consentledger
./deploy/server-setup.sh consentledger.duckdns.org
```

The script prints six numbered steps. Building the chaincode (step 3) is the
slowest part; let it run. At the end it prints the site address and where the
new walkthrough password is saved:

```
cat ~/consentledger-demo-password.txt
```

The hosted site uses this **new** password for all ten walkthrough accounts,
not the one in the repository, and its sign-in page does not list the
usernames. Give participants their username and this password on the task
sheet.

If the script stops with an error, copy the last 30 lines of output so it can
be fixed. It is safe to run again after a fix.

## F. Check and share

1. Open `https://consentledger.duckdns.org` and sign in as `tunde.adeyemi`.
2. Try one walkthrough task from each role (patient, laboratory, regulator).
3. Share the link with participants together with the questionnaire.

## Looking after the server

| Task | Command (on the server) |
|---|---|
| Is the API running? | `systemctl status consentledger-api` |
| API logs | `sudo journalctl -u consentledger-api -n 50` |
| Are the Fabric containers up? | `docker ps` |
| Get the latest code from GitHub | `./deploy/update.sh` |
| Restart everything | `sudo reboot` (all parts start again by themselves) |

Oracle may reclaim Always Free instances that sit almost completely idle for
a long time; occasional use during the questionnaire period is enough to keep
it. After the study, delete the instance from the console.

## What the script sets up

- Fabric 2.5.16 test network (two organisations, CouchDB, Raft orderer,
  Fabric CAs) with chaincode `consentaccess` v1.3 committed at sequence 1.
  This is a fresh ledger: transactions from the local evidence runs are not
  copied.
- PostgreSQL 16.4 with the same synthetic schema, seed data and accounts as
  the local build, listening only on `127.0.0.1`.
- The REST API as a systemd service on `127.0.0.1:18080`, with
  `COOKIE_SECURE=true` so the session cookie is sent only over HTTPS.
- The web app built with `VITE_HIDE_DEMO_ACCOUNTS=true`, served by Caddy,
  which also obtains and renews the HTTPS certificate.
- Firewall: only SSH, HTTP and HTTPS reach the server; outside connections
  to the Fabric and CouchDB container ports are dropped.
- Everything restarts automatically after a reboot.
