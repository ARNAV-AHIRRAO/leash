import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as db from './db.js';
import * as paypal from './paypal.js';
import { processInvoice, approve, reject, syncPayout, syncAllPending } from './pipeline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hits = new Map();

function limited(req) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(req.ip, arr);
  return arr.length > 20;
}

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

function loadSamples() {
  const dir = path.join(root, 'samples');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const fill = (t) => t.replace(/\{\{VENDOR([123])_EMAIL\}\}/g, (_, n) => config.vendorEmails[Number(n) - 1]);
  return manifest.map((m) => ({ ...m, text: fill(fs.readFileSync(path.join(dir, m.file), 'utf8')) }));
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  // Webhook needs the raw body for signature verification.
  app.post('/api/webhooks/paypal', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    try {
      const raw = req.body.toString('utf8');
      if (paypal.isMock() || !config.paypal.webhookId) return res.json({ ignored: 'webhook not configured' });
      if (!(await paypal.verifyWebhook(req.headers, raw))) return res.status(400).json({ error: 'bad signature' });
      const ev = JSON.parse(raw);
      const batchId = ev.resource?.payout_batch_id || ev.resource?.batch_header?.payout_batch_id;
      const inv = db.invoices().find((i) => i.payout?.batchId === batchId);
      if (inv) { db.audit(inv.id, 'webhook', { type: ev.event_type }); await syncPayout(inv.id); }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.use(express.json({ limit: '12mb' }));
  app.use(express.static(path.join(root, 'public')));
  app.use('/vendor/ag-grid', express.static(path.join(root, 'node_modules/ag-grid-community/dist')));
  app.use('/vendor/ag-grid-styles', express.static(path.join(root, 'node_modules/ag-grid-community/styles')));

  app.get('/healthz', (_req, res) => res.type('text').send('ok'));

  app.get('/api/state', wrap(() => ({
    paypalMode: paypal.mode(),
    llm: config.gemini.key ? `gemini (${config.gemini.models[0]})` : 'fallback parser (no GEMINI_API_KEY)',
    mandate: db.mandate(), budgetLeft: db.budgetLeft(),
    vendors: db.vendors().map((v) => ({ id: v.id, name: v.name, paypalEmail: v.paypalEmail })),
    invoices: db.invoices().map(({ excerpt, ...rest }) => rest),
  })));

  app.get('/api/invoices/:id', wrap((req) => {
    const inv = db.getInvoice(req.params.id);
    if (!inv) throw Object.assign(new Error('Not found'), { status: 404 });
    return { ...inv, audit: db.auditFor(inv.id) };
  }));

  app.post('/api/invoices', wrap((req) => {
    if (limited(req)) throw Object.assign(new Error('Slow down: too many uploads this minute.'), { status: 429 });
    return processInvoice({ text: req.body.text, pdfBase64: req.body.pdfBase64, filename: req.body.filename });
  }));
  app.post('/api/invoices/:id/approve', wrap((req) => approve(req.params.id)));
  app.post('/api/invoices/:id/reject', wrap((req) => reject(req.params.id)));
  app.post('/api/invoices/:id/sync', wrap((req) => syncPayout(req.params.id)));

  app.put('/api/mandate', wrap((req) => {
    const n = (k) => Number(req.body[k]);
    const m = { autoLimit: n('autoLimit'), hardCap: n('hardCap'), monthlyBudget: n('monthlyBudget') };
    if (![m.autoLimit, m.hardCap, m.monthlyBudget].every((v) => Number.isFinite(v) && v > 0)) throw Object.assign(new Error('All limits must be positive numbers.'), { status: 400 });
    if (!(m.autoLimit <= m.hardCap && m.hardCap <= m.monthlyBudget)) throw Object.assign(new Error('Order must be: auto-pay limit <= hard cap <= monthly budget.'), { status: 400 });
    return db.setMandate(m);
  }));

  app.get('/api/samples', wrap(() => loadSamples()));
  app.post('/api/reset', wrap(() => { db.reset(); return { ok: true }; }));

  return app;
}

export function startWorker() {
  const t = setInterval(() => syncAllPending().catch(() => {}), 10_000);
  t.unref?.();
  return t;
}
