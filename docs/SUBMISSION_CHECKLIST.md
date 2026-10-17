# Plan and checklist (today is Oct 12, 2026)

The Devpost page lists the deadline as **Nov 13, 2026 01:30 GMT+5:30**, which is **Nov 12, 20:00 UTC**. Your own target of Nov 11 is a safe buffer. Submit by Nov 7 and treat Nov 8 to 11 as buffer only.

## Phase 1: get it running (Oct 12 to 13)
- [ ] README section A: run locally in mock mode
- [ ] README B1 to B3: sandbox accounts, app, Gemini key
- [ ] README B4: `npm run check:paypal -- --payout` passes and the $1 shows in the sandbox account
- [ ] `npm start` with real keys, click **Run all samples**, click **Approve** on the $640 invoice, confirm PAID
- [ ] If any PayPal step fails, copy the exact error and send it to me before doing anything else

## Phase 2: ship it (Oct 14 to 15)
- [ ] Put your name in `LICENSE`
- [ ] README section D: GitHub repo public, MIT shows in the About box
- [ ] README section E1: Render deploy, `/healthz` says ok, header says PayPal sandbox
- [ ] README E3: GitHub `APP_URL` variable + keepalive run green + UptimeRobot monitor
- [ ] Optional: E2 webhook

## Phase 3: improve (Oct 16 to Nov 2), only what helps judging
- [ ] Watch the PayPal webinars if recordings exist (Devpost page, Webinars)
- [ ] Add 1 or 2 real screenshots (from the sandbox run, not mock) to a `docs/` folder and link them in the README
- [ ] Try 3 or 4 real invoices of your own through Gemini. Fix extraction problems you see
- [ ] Optional: use the APIMatic context plugin in your coding assistant. Mention it on Devpost only if you really used it
- [ ] Ask a friend to open the live URL cold and try it without help. Fix what confuses them

## Phase 4: freeze and record (Nov 3 to 5)
- [ ] Nov 3: **no new features**
- [ ] Re-run `npm test` and `npm run check:paypal -- --payout`
- [ ] Record the video from docs/VIDEO_SCRIPT.md, upload as **Public** on YouTube, confirm it plays logged out

## Phase 5: submit (Nov 6 to 7)
- [ ] Devpost: open the hackathon page > **Join hackathon** > start a project
- [ ] Paste sections from docs/DEVPOST_TEXT.md (fill [LIVE URL], [GITHUB URL], [YOUTUBE URL])
- [ ] Fields to confirm: text description, tools used and how, public GitHub link with license visible, hosted demo URL, YouTube link, testing instructions
- [ ] Choose the sponsor prize categories you genuinely used: Best Use of AG Grid, Best Use of Render, Best Use of PayPal + AI, Best Use of Agentic Commerce (if offered on the form)
- [ ] Click **Submit**. Check you get the confirmation and the project shows as submitted, not draft

## Phase 6: stay alive until results (Nov 8 onward)
- [ ] Every 3 or 4 days: open the live URL, click **Run all samples**, confirm payouts reach PAID
- [ ] Check the GitHub Actions keepalive is still green
- [ ] If a model name stops working, set `GEMINI_MODEL` on Render > Environment
- [ ] Do not push risky changes during judging. If you must, run `npm test` first and re-verify the live URL after
