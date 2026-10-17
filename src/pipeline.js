import crypto from 'node:crypto';
import * as db from './db.js';
import { extract, normTaxId } from './extract.js';
import { decide } from './policy.js';
import { payVendor, payoutStatus } from './paypal.js';

const round2 = (n) => Math.round(n * 100) / 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function pay(inv, email) {
  try {
    const p = await payVendor({
      id: inv.id, amount: inv.amount.toFixed(2), currency: inv.currency, email,
      note: `Invoice ${inv.invoiceNumber} (${inv.vendorName})`,
    });
    db.audit(inv.id, 'payout_submitted', { batchId: p.batchId, to: email, mock: p.mock });
    return db.updateInvoice(inv.id, { status: 'PAYING', payout: { batchId: p.batchId, email, detail: p.status, mock: p.mock } });
  } catch (e) {
    db.audit(inv.id, 'payout_error', { message: e.message });
    return db.updateInvoice(inv.id, { status: 'FAILED', error: e.message });
  }
}

export async function processInvoice({ text, pdfBase64, filename }) {
  if (!text && !pdfBase64) throw Object.assign(new Error('Send invoice text or a PDF.'), { status: 400 });
  if (text && text.length > 20000) throw Object.assign(new Error('Invoice text is too long (max 20,000 characters).'), { status: 413 });

  const sha = crypto.createHash('sha256').update(text || pdfBase64).digest('hex');
  const { x, notes } = await extract({ text, pdfBase64 });

  const amount = round2(x.total);
  const mandate = db.mandate();
  const vendor = db.findVendor(x.vendorName);
  const lineSum = round2(x.lineItems.reduce((a, l) => a + (Number.isFinite(l.amount) ? l.amount : 0), 0));

  const taxSet = [...new Set(x.taxIds.map(normTaxId).filter(Boolean))];
  const taxConflict = taxSet.length > 1 ? `Seller shows ${taxSet.length} different tax/VAT numbers (${taxSet.join(' vs ')})` : null;
  const taxMismatchVendor = vendor?.taxId && taxSet.length && !taxSet.includes(vendor.taxId)
    ? `Tax/VAT number on the invoice (${taxSet[0]}) differs from the one on file for this vendor` : null;

  const d = decide({
    amount, currency: x.currency,
    currencyAllowed: mandate.currencies.includes(x.currency),
    budgetLeft: db.budgetLeft(),
    duplicate: db.isDuplicate(x.vendorName, x.invoiceNumber, sha),
    sumMismatch: x.lineItems.length > 0 && Math.abs(lineSum - amount) > 0.01,
    injection: x.injection, markedPaid: x.markedPaid, taxConflict, taxMismatchVendor,
    vendorKnown: !!vendor, vendorMedian: vendor?.median ?? null,
    invoiceEmail: x.payeeEmail && EMAIL_RE.test(x.payeeEmail) ? x.payeeEmail : null,
    vendorEmail: vendor?.paypalEmail ?? null,
  }, mandate);

  let inv = db.insertInvoice({
    id: db.newId('inv'), createdAt: new Date().toISOString(), sha,
    filename: filename || null, excerpt: (text || '[PDF document]').slice(0, 3000),
    extractor: x.extractor, extractorNotes: notes,
    vendorId: vendor?.id ?? null, vendorName: x.vendorName, invoiceNumber: x.invoiceNumber,
    amount, currency: x.currency, lineItems: x.lineItems, invoiceEmail: x.payeeEmail, taxIds: taxSet, markedPaid: x.markedPaid,
    injection: x.injection, summary: x.summary,
    verdict: d.verdict, reasons: d.reasons,
    status: d.verdict === 'DENY' ? 'DENIED' : d.verdict === 'NEEDS_APPROVAL' ? 'AWAITING_APPROVAL' : 'PAYING',
    payout: null, error: null,
  });
  db.audit(inv.id, 'extracted', { extractor: x.extractor, notes });
  db.audit(inv.id, 'decided', d);

  if (d.verdict === 'AUTO_PAY') inv = await pay(inv, vendor.paypalEmail);
  return inv;
}

export async function approve(id) {
  const inv = db.getInvoice(id);
  if (!inv) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
  if (inv.status !== 'AWAITING_APPROVAL') throw Object.assign(new Error(`Cannot approve an invoice that is ${inv.status}.`), { status: 409 });
  if (inv.amount > db.budgetLeft()) throw Object.assign(new Error('Not enough monthly budget left.'), { status: 409 });
  if (inv.amount > db.mandate().hardCap) throw Object.assign(new Error('Amount is over the hard cap.'), { status: 409 });

  let vendor = inv.vendorId ? db.vendors().find((v) => v.id === inv.vendorId) : null;
  if (!vendor) {
    // New vendor: the human approving this has just reviewed the payee email.
    if (!inv.invoiceEmail || !EMAIL_RE.test(inv.invoiceEmail)) throw Object.assign(new Error('No valid payee email.'), { status: 409 });
    vendor = db.addVendor({ name: inv.vendorName, paypalEmail: inv.invoiceEmail, taxId: inv.taxIds?.length === 1 ? inv.taxIds[0] : null, addedBy: `approval of ${inv.id}` });
    db.updateInvoice(id, { vendorId: vendor.id });
    db.audit(id, 'vendor_added', { vendor: vendor.name, email: vendor.paypalEmail });
  }
  db.audit(id, 'approved', { by: 'human' });
  return pay(db.getInvoice(id), vendor.paypalEmail);
}

export function reject(id) {
  const inv = db.getInvoice(id);
  if (!inv) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
  if (inv.status !== 'AWAITING_APPROVAL') throw Object.assign(new Error(`Cannot reject an invoice that is ${inv.status}.`), { status: 409 });
  db.audit(id, 'rejected', { by: 'human' });
  return db.updateInvoice(id, { status: 'REJECTED' });
}

export async function syncPayout(id) {
  const inv = db.getInvoice(id);
  if (!inv?.payout?.batchId || inv.status !== 'PAYING') return inv;
  try {
    const s = await payoutStatus(inv.payout.batchId);
    if (s.state === 'PAYING') return db.updateInvoice(id, { payout: { ...inv.payout, detail: s.detail } });
    db.audit(id, 'payout_status', s);
    return db.updateInvoice(id, { status: s.state, payout: { ...inv.payout, detail: s.detail }, error: s.state === 'FAILED' ? s.detail : null });
  } catch (e) {
    db.audit(id, 'sync_error', { message: e.message });
    return inv;
  }
}

export async function syncAllPending() {
  for (const i of db.invoices().filter((x) => x.status === 'PAYING')) await syncPayout(i.id);
}
