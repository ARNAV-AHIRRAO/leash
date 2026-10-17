// npm run check:paypal            -> verifies your sandbox credentials
// npm run check:paypal -- --payout -> also sends a $1.00 sandbox payout to VENDOR1_EMAIL
import { config } from '../src/config.js';
import { isMock, ensureToken, payVendor, payoutStatus } from '../src/paypal.js';

if (isMock()) {
  console.error('No PAYPAL_CLIENT_ID / PAYPAL_SECRET found in .env. Fill them in first.');
  process.exit(1);
}
try {
  await ensureToken();
  console.log('OK: sandbox credentials work (OAuth token issued).');
} catch (e) { console.error('FAILED:', e.message); process.exit(1); }

if (process.argv.includes('--payout')) {
  const id = `check${Date.now()}`;
  try {
    const p = await payVendor({ id, amount: '1.00', currency: 'USD', email: config.vendorEmails[0], note: 'Leash connectivity check' });
    console.log('Payout submitted:', p);
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const s = await payoutStatus(p.batchId);
      console.log('Status:', s);
      if (s.state !== 'PAYING') break;
    }
  } catch (e) {
    console.error('Payout FAILED:', e.message);
    console.error('If this says NOT_AUTHORIZED / 403, Payouts is not enabled for this sandbox app. See README Troubleshooting.');
    process.exit(1);
  }
}
