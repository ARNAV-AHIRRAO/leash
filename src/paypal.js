// PayPal SANDBOX client. The base URL is hard-coded to sandbox on purpose:
// this project can never move real money.
import { config } from './config.js';

const BASE = 'https://api-m.sandbox.paypal.com';
const MOCK_DELAY_MS = 4000;
const mockBatches = new Map();

export const isMock = () => config.paypal.forceMock || !(config.paypal.clientId && config.paypal.secret);
export const mode = () => (isMock() ? 'mock' : 'sandbox');

let tok = null;
async function token() {
  if (tok && tok.exp > Date.now() + 30_000) return tok.v;
  const auth = Buffer.from(`${config.paypal.clientId}:${config.paypal.secret}`).toString('base64');
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal auth failed (${r.status}): ${j.error_description || JSON.stringify(j)}`);
  tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tok.v;
}

export const ensureToken = token;

export async function pp(path, init = {}, requestId) {
  const r = await fetch(BASE + path, {
    ...init,
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      ...(init.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`PayPal ${r.status}: ${j.message || j.name || 'error'} ${j.details ? JSON.stringify(j.details) : ''}`.trim());
    e.paypal = j; e.status = r.status;
    throw e;
  }
  return j;
}

// Pay one vendor. sender_batch_id + PayPal-Request-Id = same invoice can never pay twice.
export async function payVendor({ id, amount, currency, email, note }) {
  if (isMock()) {
    const batchId = `MOCK-${id}`;
    mockBatches.set(batchId, Date.now());
    return { batchId, status: 'PENDING', mock: true };
  }
  const j = await pp('/v1/payments/payouts', {
    method: 'POST',
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: `leash-${id}`, email_subject: 'Payment from Leash (sandbox demo)', email_message: note },
      items: [{ recipient_type: 'EMAIL', receiver: email, amount: { value: amount, currency }, note, sender_item_id: id }],
    }),
  }, `leash-${id}`);
  return { batchId: j.batch_header.payout_batch_id, status: j.batch_header.batch_status, mock: false };
}

// Collapse PayPal's batch + item statuses into PAYING | PAID | FAILED.
export function normalizePayout(j) {
  const batch = j.batch_header?.batch_status || 'PENDING';
  const items = j.items || [];
  const bad = items.find((i) => ['FAILED', 'BLOCKED', 'RETURNED', 'REFUNDED', 'DENIED', 'CANCELED'].includes(i.transaction_status));
  if (bad) return { state: 'FAILED', detail: `${bad.transaction_status}${bad.errors?.message ? `: ${bad.errors.message}` : ''}` };
  if (['DENIED', 'CANCELED'].includes(batch)) return { state: 'FAILED', detail: `Batch ${batch}` };
  if (items.some((i) => i.transaction_status === 'UNCLAIMED')) return { state: 'PAID', detail: 'UNCLAIMED: recipient has no PayPal account yet' };
  if (batch === 'SUCCESS' && items.length && items.every((i) => i.transaction_status === 'SUCCESS')) return { state: 'PAID', detail: 'SUCCESS' };
  return { state: 'PAYING', detail: batch };
}

export async function payoutStatus(batchId) {
  if (String(batchId).startsWith('MOCK-')) {
    const t = mockBatches.get(batchId);
    return t && Date.now() - t < MOCK_DELAY_MS ? { state: 'PAYING', detail: 'PENDING (mock)' } : { state: 'PAID', detail: 'SUCCESS (mock)' };
  }
  return normalizePayout(await pp(`/v1/payments/payouts/${batchId}?page_size=5`));
}

export async function verifyWebhook(headers, rawBody) {
  if (!config.paypal.webhookId) return false;
  const h = (k) => headers[k];
  const r = await pp('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'),
      transmission_id: h('paypal-transmission-id'), transmission_sig: h('paypal-transmission-sig'),
      transmission_time: h('paypal-transmission-time'),
      webhook_id: config.paypal.webhookId, webhook_event: JSON.parse(rawBody),
    }),
  });
  return r.verification_status === 'SUCCESS';
}
