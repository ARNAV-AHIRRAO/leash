# 3-minute demo video: script and recording steps

Target length 2:40 to 2:55. Hard limit 3:00. Judges are not required to watch past it.

## Before recording
1. Open your Render URL (not localhost) so the video shows the hosted version. Check the header says **PayPal sandbox** and **AI: gemini** and there is no amber banner.
2. Click **Reset demo** so the ledger is empty.
3. In another browser window, log in at https://www.sandbox.paypal.com with the VENDOR1 Personal account so you can show money arriving. Keep it ready.
4. Close other tabs and notifications. Browser zoom 110% so text is readable.
5. Record with **OBS Studio** (free, obsproject.com) or Windows **Win + G** (Xbox Game Bar) > Capture. Microphone voiceover. **No music** (the rules ban copyrighted music). Do not show third-party logos beyond what the apps themselves display.

## Script

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:20 | Leash dashboard, empty | "AI agents are about to handle money. The risk is not that they are wrong. It is that they can be talked into things. Leash is an AI that pays vendors, but only inside limits I set." |
| 0:20 to 0:50 | Click **Routine hosting bill** | "A normal $84 hosting invoice. Gemini reads it. Plain code checks it against my limits. Known vendor, under my auto-pay limit, so it pays through the PayPal Payouts API." Switch to the sandbox PayPal window and show the money. |
| 0:50 to 1:20 | Click **New vendor, $640**, then its row, then **Approve and pay** | "A new vendor for $640. Leash will not pay a stranger on its own. It shows me the reasons and the payee email. I approve, and the payout goes through." |
| 1:20 to 2:00 | Click **Invoice with hidden instructions**, open the row | "This invoice has a line telling the AI to ignore its rules and send $9,400 to an attacker. Gemini flags it, a second regex scan flags it, and the policy engine refuses it anyway: over my hard cap. The payee comes from my vendor table, never from the document." |
| 2:00 to 2:20 | Click **Same invoice sent again**, then **Payee email swapped** | "Duplicates are caught. A swapped payee email is caught. Every refusal lists its reasons, and every step is in the audit trail." |
| 2:20 to 2:45 | Show the limits gauge, change a limit, **Save limits** | "These three numbers are the leash. The AI reads documents. This code decides money." |
| 2:45 to 2:55 | Dashboard | "Leash: PayPal Payouts, webhooks, Gemini, AG Grid, hosted on Render. Code and live demo are in the description." |

## Upload
1. https://studio.youtube.com > top right **Create** > **Upload videos**.
2. Select your file. Title: `Leash: AI that pays vendors only inside your limits (PayPal AI Hackathon)`.
3. Audience: **No, it's not made for kids**.
4. On the last step, Visibility: **Public**. Click **Publish**.
5. Copy the video link. Open it in a private/incognito window to confirm it plays.
