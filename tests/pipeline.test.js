import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated mock-mode environment: no network, temp data dir.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leash-'));
process.env.PAYPAL_MODE = 'mock';
process.env.GEMINI_API_KEY = '';
process.env.VENDOR1_EMAIL = 'v1@sandbox.test';
process.env.VENDOR2_EMAIL = 'v2@sandbox.test';
process.env.VENDOR3_EMAIL = 'v3@sandbox.test';

const { createApp } = await import('../src/server.js');
const { init } = await import('../src/db.js');
init();

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const j = async (p, o) => { const r = await fetch(base + p, o); return { status: r.status, body: await r.json() }; };
const post = (p, body) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

test('all 8 samples get the expected verdicts, in order', async () => {
  const samples = (await j('/api/samples')).body;
  assert.equal(samples.length, 8);
  const out = {};
  for (const s of samples) out[s.file] = (await post('/api/invoices', { text: s.text })).body;

  assert.equal(out['01-auto-pay.txt'].verdict, 'AUTO_PAY');
  assert.equal(out['01-auto-pay.txt'].status, 'PAYING');
  assert.equal(out['01-auto-pay.txt'].payout.email, 'v1@sandbox.test');
  assert.equal(out['02-new-vendor.txt'].verdict, 'NEEDS_APPROVAL');
  assert.equal(out['03-duplicate.txt'].verdict, 'DENY');
  assert.equal(out['04-injection.txt'].verdict, 'DENY');
  assert.equal(out['04-injection.txt'].injection, true);
  assert.equal(out['04-injection.txt'].payout, null);
  assert.equal(out['05-payee-swap.txt'].verdict, 'DENY');
  assert.equal(out['06-bad-math.txt'].verdict, 'DENY');
  assert.equal(out['07-over-limit.txt'].verdict, 'NEEDS_APPROVAL');
  assert.equal(out['08-vat-conflict.txt'].verdict, 'DENY');
  assert.ok(out['08-vat-conflict.txt'].reasons.some((r) => /different tax\/VAT numbers/.test(r)));
  assert.ok(out['08-vat-conflict.txt'].reasons.some((r) => /already paid/.test(r)));
});

test('approval pays the confirmed payee and registers the new vendor', async () => {
  const state = (await j('/api/state')).body;
  const inv = state.invoices.find((i) => i.invoiceNumber === 'ZS-7730');
  const res = await post(`/api/invoices/${inv.id}/approve`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'PAYING');
  assert.equal(res.body.payout.email, 'v3@sandbox.test');
  assert.ok((await j('/api/state')).body.vendors.some((v) => v.name === 'Zeta Office Supplies'));
});

test('approving twice or approving a denied invoice is refused', async () => {
  const state = (await j('/api/state')).body;
  const paid = state.invoices.find((i) => i.invoiceNumber === 'ZS-7730');
  const denied = state.invoices.find((i) => i.invoiceNumber === 'NW-2026-1099');
  assert.equal((await post(`/api/invoices/${paid.id}/approve`)).status, 409);
  assert.equal((await post(`/api/invoices/${denied.id}/approve`)).status, 409);
});

test('mock payouts settle to PAID after sync', async () => {
  await new Promise((r) => setTimeout(r, 4200));
  const inv = (await j('/api/state')).body.invoices.find((i) => i.invoiceNumber === 'NW-2026-1041' && i.status === 'PAYING');
  const synced = await post(`/api/invoices/${inv.id}/sync`);
  assert.equal(synced.body.status, 'PAID');
});

test('mandate validation', async () => {
  const bad = await j('/api/mandate', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoLimit: 500, hardCap: 100, monthlyBudget: 3000 }) });
  assert.equal(bad.status, 400);
});

test('garbage input is a clean 422, not a crash', async () => {
  assert.equal((await post('/api/invoices', { text: 'hello world' })).status, 422);
  assert.equal((await post('/api/invoices', {})).status, 400);
});

test('reset restores the seed', async () => {
  await post('/api/reset');
  assert.equal((await j('/api/state')).body.invoices.length, 0);
});
