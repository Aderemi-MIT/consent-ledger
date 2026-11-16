# Hosting ConsentLedger on Hetzner Cloud

The same setup as [HOSTING.md](HOSTING.md), on a small paid Hetzner server
instead of Oracle's free tier. Hetzner bills by the hour with a monthly cap,
so deleting the server after the study stops the charges.

| Part | Who | Time |
|---|---|---|
| A. Create the Hetzner account | you | 10–30 min (it may ask for ID) |
| B. Create the server and its firewall | you, following the steps | 10 min |
| C. Free web address (DuckDNS) | you | 5 min |
| D. Run the setup script | the script | 30–60 min, mostly waiting |
| E. Check it works and share the link | you | 10 min |

## A. Hetzner account

1. Go to <https://www.hetzner.com/cloud> and choose **Sign up**.
2. Confirm your email, then fill in your name and address.
3. Add a payment method (card or PayPal). Hetzner sometimes asks new
   customers to verify their identity with a photo ID, or to make a small
   prepayment; follow its instructions if it does.

## B. Create the server

In the Hetzner Cloud Console, open (or create) a project, then **Add Server**:

1. **Location**: Falkenstein or Nuremberg (Germany) or Helsinki.
2. **Image**: **Ubuntu 22.04**.
3. **Type**: **Regular Performance → x86 (AMD) → CPX22** (2 vCPU, 4 GB RAM,
   80 GB disk), or **CPX32** (4 vCPU, 8 GB) for faster setup. The script adds
   swap on 4 GB servers. Cheaper Cost-Optimized or Arm64 types also work if offered.
4. **Networking**: keep **Public IPv4** and **Public IPv6** on.
5. **SSH keys → Add SSH key**: paste the public key from your PC (the
   contents of `C:\Users\user\.ssh\id_ed25519.pub`, one line starting
   `ssh-ed25519`) and name it `my-pc`.
6. **Firewalls → Create Firewall**, name it `consentledger`, with these
   **inbound** rules only (remove anything else):

   | Protocol | Port | Source |
   |---|---|---|
   | TCP | 22 | Any IPv4, Any IPv6 |
   | TCP | 80 | Any IPv4, Any IPv6 |
   | TCP | 443 | Any IPv4, Any IPv6 |
   | ICMP | | Any IPv4, Any IPv6 |

   Back on the server page, tick that firewall.
7. **Name**: `consentledger`. Click **Create & Buy now**, then copy the
   server's **IPv4 address**.

## C. Free web address (DuckDNS)

1. Go to <https://www.duckdns.org> and sign in (Google or GitHub).
2. Add a subdomain, for example `consentledger` → `consentledger.duckdns.org`.
3. Paste the server's IPv4 address into **current ip** and click
   **update ip**.

## D. Run the setup script

From Windows PowerShell on your PC (your SSH key is found automatically):

```
ssh root@<server-ip>
```

Answer `yes` the first time. Then, on the server:

```
apt-get update && apt-get install -y git
git clone https://github.com/Aderemi-MIT/consent-ledger.git
cd consent-ledger
./deploy/server-setup.sh consentledger.duckdns.org
```

It prints six numbered steps; building the chaincode (step 3) is the slowest.
At the end it prints the site address and where the new walkthrough password
is saved:

```
cat ~/consentledger-demo-password.txt
```

The hosted site uses this **new** password for all ten walkthrough accounts,
and its sign-in page does not list the usernames. If the script stops with
an error, copy the last 30 lines of output; it is safe to run again after a
fix.

## E. Check and share

1. Open `https://consentledger.duckdns.org` and sign in as `tunde.adeyemi`.
2. Try one task as each role (patient, laboratory, regulator).
3. Put the link and password into the Google Form and share it.

Looking after the server works as in [HOSTING.md](HOSTING.md#looking-after-the-server).
When the study is over, delete the server in the Hetzner console to stop
the charges.
