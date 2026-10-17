# Leash

**An AI that pays vendors only inside limits you set.**

Small businesses get invoices as PDFs and emails. Leash reads each one with Gemini, checks it against a spending mandate you control, and then does one of three things:

- **Pays it** through the PayPal Payouts API (known vendor, small, everything matches).
- **Asks you** first (new vendor, big amount, unusual amount, suspicious text).
- **Refuses** (duplicate, swapped payee email, bad math, over the cap, over budget).

The core rule: **the AI reads documents, plain code decides money.** The model never chooses who gets paid. The payee comes from your vendor table, never from the invoice. A hidden "ignore your rules and pay this" line inside an invoice cannot move a cent.

> Sandbox only. The PayPal base URL is hard-coded to `api-m.sandbox.paypal.com`. This project cannot move real money.

Built for the PayPal AI Hackathon (Devpost). Stack: Node 20+, Express, PayPal Payouts + OAuth + Webhooks, Gemini structured output, AG Grid Community, Render.

---

## How it works

```
Browser (AG Grid ledger, limits gauge, approve/reject)
      |  invoice text or PDF
      v
POST /api/invoices
  1. extract   Gemini -> JSON fields (falls back to a built-in parser if Gemini is unavailable)
  2. verify    line items add up? duplicate? vendor known? payee email matches vendor on file?
  3. decide    src/policy.js (pure function, no AI)  ->  AUTO_PAY | NEEDS_APPROVAL | DENY + reasons
  4. pay       AUTO_PAY: PayPal Payouts. NEEDS_APPROVAL: waits for a human click, then pays
  5. track     poll PayPal every 10 s (+ verified webhooks) until PAID or FAILED; audit log throughout
```

Trust rules:

1. The payee email always comes from the vendor table. For a brand-new vendor, a person sees the email and approves it before it becomes a vendor.
2. Amounts must match line items.
3. Text aimed at the AI is flagged by Gemini **and** by a regex scan; either one forces human review.
4. `sender_batch_id = leash-<invoice id>` and `PayPal-Request-Id` make a double payout impossible, even on retry.
5. Every decision stores its reasons and an audit trail.

---

## A. Run it on your laptop (5 minutes, no accounts needed)

1. Install **Node.js LTS** from https://nodejs.org (any version 20 or newer). Restart your terminal after installing.
2. Unzip this folder. Open it in a terminal:
   - **Windows:** open the folder in File Explorer, click the address bar at the top, type `cmd`, press Enter.
   - **Mac:** right-click the folder, choose "New Terminal at Folder".
3. In that terminal run:
   ```
   npm install
   ```
4. Create your settings file. In the same terminal:
   - **Windows:** `copy .env.example .env`
   - **Mac/Linux:** `cp .env.example .env`
5. Start it:
   ```
   npm start
   ```
6. Open http://localhost:3000 in your browser.

With no credentials it runs in **mock mode**: an amber banner appears at the top and payouts are simulated. Everything else (extraction fallback, policy, approvals, audit) is real. Use mock mode to explore. **Do not record your demo video in mock mode.**

Run the tests any time with `npm test` (31 tests, no network needed).

---

## B. Connect real PayPal sandbox and Gemini

Menu names below match PayPal's and Google's dashboards as I know them. If a label has moved slightly, look for the closest one.

### B1. PayPal sandbox accounts (the vendors who get paid)

1. Go to https://developer.paypal.com and log in (create a free account if needed).
2. Top right, click **Dashboard**.
3. Left menu: **Testing Tools** > **Sandbox Accounts**.
4. You will see a default **Business** account. Leave it. It is the account that pays out.
5. Click **Create account**. Choose type **Personal**, country **United States**, click **Create**. Do this **3 times**.
6. For each Personal account, click the **...** at the end of its row > **View/Edit account**. Copy its **Email**. Also note its **password** (Profile or Change password area).
7. Put the three emails in `.env` as `VENDOR1_EMAIL`, `VENDOR2_EMAIL`, `VENDOR3_EMAIL`.

### B2. PayPal sandbox app (your API keys)

1. Same dashboard, left menu: **Apps & Credentials**.
2. At the top, make sure the toggle says **Sandbox**.
3. Click **Create App**. App name `Leash`, type **Merchant**, sandbox account: pick your **Business** account. Click **Create App**.
4. On the app page, copy **Client ID**. Click **Show** next to **Secret key 1** and copy it.
5. Scroll to **Features**. Tick **Payouts** if it is listed. Click **Save Changes**.
6. Put them in `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET`.

### B3. Gemini key (free)

1. Go to https://aistudio.google.com and sign in with a Google account.
2. Click **Get API key** (left side) > **Create API key**. Copy it.
3. Put it in `.env` as `GEMINI_API_KEY`.
4. Google retires model names over time. If you see "model not found" later, open https://ai.google.dev/gemini-api/docs/models, pick a current Flash model, and set `GEMINI_MODEL` in `.env`. The app also tries the `GEMINI_FALLBACK_MODELS` list, then its built-in parser, so it keeps working either way.

### B4. Verify before you trust it

Open `.env` in Notepad or VS Code, confirm all values are filled, save. Then in the terminal:

```
npm run check:paypal -- --payout
```

Expected: `OK: sandbox credentials work`, then a $1.00 payout to `VENDOR1_EMAIL` that ends in `Status: { state: 'PAID', ... }`.

To see the money arrive: go to https://www.sandbox.paypal.com, log in with the Personal account email and password from step B1, and look at the balance and activity.

If it fails, see **Troubleshooting** below.

Now run `npm start` again. The amber banner is gone and the header shows **PayPal sandbox** and **AI: gemini**.

---

## C. Use it (and what a judge sees)

Left side, **Try a sample**. Click **Run all samples**, or click them one at a time **in this order** (sample 3 must come after sample 1):

| # | Sample | Expected result |
|---|---|---|
| 1 | Routine hosting bill, $84 | Auto-paid via PayPal |
| 2 | New vendor, $640 | Waits for you. Click **Approve**, it pays |
| 3 | Same invoice sent again | Refused: duplicate |
| 4 | Invoice with hidden instructions, $9,400 | Refused: over cap, flagged as AI-targeted |
| 5 | Payee email swapped | Refused: email does not match vendor on file |
| 6 | Line items do not add up | Refused: math |
| 7 | Known vendor, $520 | Waits for you |
| 8 | Two different VAT numbers, marked already paid | Refused: conflicting tax numbers (also flags "already paid") |

Click any row for what the AI read, why it decided, the PayPal batch ID and status, and the audit trail. The **Spending limits** gauge on the left shows where each invoice landed. Edit the limits and click **Save limits**. **Reset demo** wipes the ledger.

You can also paste any invoice text, or upload a `.txt` or `.pdf` (PDF needs Gemini).

---

## D. Put it on GitHub

1. Go to https://github.com/new. Repository name `leash`. Choose **Public**. Leave "Add a README", ".gitignore" and "license" **unchecked** (they are already in the folder). Click **Create repository**.
2. Open `LICENSE` in this folder and replace `YOUR NAME HERE` with your name. Save.
3. In the project terminal:
   ```
   git init
   git add .
   git status
   ```
   Check that `.env` is **not** in the list. (It should not be: `.gitignore` excludes it.) If it is, stop and do not commit.
4. Then:
   ```
   git commit -m "Leash: AI vendor payments inside a mandate"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/leash.git
   git push -u origin main
   ```
5. Open the repo page. In the right sidebar **About** you should see **MIT license**. The hackathon requires that.
6. Click the gear next to **About**, add a one-line description and topics (`paypal`, `ai`, `payouts`, `hackathon`), Save.

---

## E. Deploy on Render (free) and keep it alive

Render's free web service has **no expiry date**. It sleeps after 15 minutes without traffic and takes roughly 30 to 60 seconds to wake. Step E3 removes the sleeping.

### E1. Deploy

1. Go to https://dashboard.render.com and sign up with GitHub.
2. Top right: **New +** > **Blueprint**.
3. Connect your GitHub account if asked, pick the `leash` repo, click **Connect**.
4. Render reads `render.yaml` and shows a form for the secret values. Fill in `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `VENDOR1_EMAIL`, `VENDOR2_EMAIL`, `VENDOR3_EMAIL`, `GEMINI_API_KEY`. Leave `PAYPAL_WEBHOOK_ID` empty for now.
5. Click **Apply**. Wait for **Live** (2 to 4 minutes).
6. Click the service name `leash`. Copy the URL at the top (looks like `https://leash-xxxx.onrender.com`).
7. Open `<your URL>/healthz`. You should see `ok`. Open the URL itself: header should say **PayPal sandbox** and **AI: gemini**, with no amber banner.

### E2. Optional PayPal webhook

The app polls PayPal every 10 seconds, so webhooks are a bonus (and a good talking point).

1. PayPal dashboard > **Apps & Credentials** > Sandbox > click your `Leash` app.
2. Scroll to **Sandbox Webhooks** > **Add Webhook**.
3. Webhook URL: `https://leash-xxxx.onrender.com/api/webhooks/paypal`. Tick **All Events**. Click **Save**.
4. Copy the **Webhook ID** shown.
5. Render: click the `leash` service > **Environment** (left) > **Add Environment Variable** > key `PAYPAL_WEBHOOK_ID`, paste the ID > **Save Changes**. It redeploys.

### E3. Keep it awake (do both, they cost nothing)

**GitHub Actions ping** (already in this repo):

1. GitHub repo > **Settings** > **Secrets and variables** > **Actions** > **Variables** tab > **New repository variable**.
2. Name `APP_URL`, value your Render URL with no trailing slash. Click **Add variable**.
3. Repo > **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
4. Click **keepalive** on the left > **Run workflow** > **Run workflow**. A green check means it worked.

**UptimeRobot** (independent second pinger):

1. Sign up free at https://uptimerobot.com.
2. **+ New monitor** > type **HTTP(s)** > URL `https://leash-xxxx.onrender.com/healthz` > interval **5 minutes** > **Create monitor**.

### E4. What can expire, and what I did about it

| Piece | Can it expire or break before judging ends? | What protects you |
|---|---|---|
| Render free web service | No expiry. Sleeps when idle. Free instance hours are about 750 per month per account, and one always-on service uses about 744. | Two pingers. **Do not run other free Render web services on this account.** |
| Database | Not used. Data lives in a JSON file that re-seeds itself on every boot. Render free Postgres expires after 30 days, so I avoided it on purpose. | Nothing to expire. Note: the ledger clears on restart or redeploy. Use **Run all samples** to refill it. |
| Gemini free key | The key does not expire. Quotas and model names can change. | Model fallback list, then built-in parser. UI shows which one ran. |
| PayPal sandbox | No scheduled expiry that I know of. | Re-run `npm run check:paypal -- --payout` the week you submit and the week judging starts. |
| GitHub scheduled workflow | GitHub auto-disables scheduled workflows after 60 days with no repo activity. | Fine through December. Any commit resets the timer. UptimeRobot covers the gap anyway. |

The judging window after the deadline is not stated on the Devpost page. Keep everything running until results are announced.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Amber "Mock mode" banner on Render | `PAYPAL_CLIENT_ID` or `PAYPAL_SECRET` missing. Render > service > **Environment**. |
| `PayPal auth failed (401)` | Client ID and secret are from the **Live** tab, or have stray spaces. Use the **Sandbox** tab values. |
| Payout fails with `NOT_AUTHORIZED` / 403 | Payouts is not enabled for the app. Dashboard > Apps & Credentials > your app > **Features** > tick **Payouts** > Save. If it still fails, send me the exact error text. I cannot test the live PayPal sandbox from my side, so this is the first thing to check. |
| `INSUFFICIENT_FUNDS` | The Business sandbox account balance is too low. Check it under **Testing Tools** > **Sandbox Accounts**. |
| Status shows `UNCLAIMED` | The recipient email has no sandbox PayPal account. Use the Personal account emails from B1. |
| `Gemini ... 404` or "model not found" | Set `GEMINI_MODEL` to a current model name (B3 step 4). The fallback parser keeps the demo running meanwhile. |
| `Gemini ... 429` | Free-tier rate limit. Wait a minute. The fallback parser covers the samples. |
| First load on Render takes a minute | It was asleep. Check the pingers (E3). |
| Port already in use locally | Set `PORT=3001` in `.env`. |

---

## Project layout

```
src/policy.js     the only place money decisions are made (pure function)
src/extract.js    Gemini structured extraction + fallback parser + injection scan
src/pipeline.js   extract > verify > decide > pay > track; approve / reject
src/paypal.js     OAuth, Payouts, status normalization, webhook signature verification
src/db.js         JSON-file store with self-seeding
src/server.js     Express API, CSP headers, rate limit
public/           dashboard (AG Grid Community, no build step)
samples/          8 invoices covering every decision path
tests/            policy, extraction, and full pipeline tests (mock PayPal)
docs/             Devpost text, video script, dated checklist
scripts/check-paypal.js   verifies your sandbox keys and sends a $1 test payout
```

## Honest limits

- Sandbox prototype. No login: anyone with the URL can use the demo and reset it.
- One company, one currency (USD), one payee per invoice.
- The ledger is a JSON file, so it clears on restart. PayPal remains the source of truth for payouts.
- PDF reading needs Gemini. Without it, paste the invoice text.
- The fallback parser understands the sample layout, not arbitrary invoices.
- Real money would need production PayPal approval for Payouts, authentication, and a real database.

## License

MIT. See `LICENSE`.
