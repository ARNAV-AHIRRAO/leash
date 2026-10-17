// Tiny JSON-file store. No external database, so nothing can expire or sleep
// out from under the demo. On a fresh or wiped disk it re-seeds itself on boot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const dir = () => config.dataDir || path.resolve(process.cwd(), 'data');
const file = () => path.join(dir(), 'db.json');
let state = null;

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const newId = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;

function seedState() {
  return {
    mandate: { autoLimit: 200, hardCap: 1000, monthlyBudget: 3000, currencies: ['USD'] },
    vendors: [
      { id: 'v_northwind', name: 'Northwind Hosting', paypalEmail: config.vendorEmails[0], median: 80, addedBy: 'seed' },
      { id: 'v_acme', name: 'Acme Design Studio', paypalEmail: config.vendorEmails[1], median: 450, addedBy: 'seed' },
    ],
    invoices: [],
    events: [],
  };
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Atomic write. On Windows, antivirus or the indexer can briefly lock db.json and make
// rename fail with EPERM/EBUSY/EACCES, so retry, then fall back to a direct write.
function persist() {
  fs.mkdirSync(dir(), { recursive: true });
  const data = JSON.stringify(state, null, 1);
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let n = 0; ; n++) {
    try { fs.renameSync(tmp, file()); return; }
    catch (e) {
      if (n < 8 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { sleepSync(15 * (n + 1)); continue; }
      try { fs.writeFileSync(file(), data); fs.rmSync(tmp, { force: true }); return; } catch { throw e; }
    }
  }
}

export function init() {
  try {
    state = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    state = seedState();
    persist();
  }
  return state;
}
const s = () => state ?? init();

export const reset = () => { state = seedState(); persist(); };
export const snapshot = () => s();
export const mandate = () => s().mandate;
export function setMandate(p) { Object.assign(s().mandate, p); persist(); return s().mandate; }

export const vendors = () => s().vendors;
export function findVendor(name) {
  const n = norm(name);
  if (!n) return null;
  return s().vendors.find((v) => {
    const vn = norm(v.name);
    return vn === n || (n.length >= 6 && vn.includes(n)) || (vn.length >= 6 && n.includes(vn));
  }) || null;
}
export function addVendor(v) { const rec = { id: newId('v'), median: null, ...v }; s().vendors.push(rec); persist(); return rec; }

export const invoices = () => s().invoices;
export const getInvoice = (id) => s().invoices.find((i) => i.id === id) || null;
export function insertInvoice(inv) { s().invoices.unshift(inv); persist(); return inv; }
export function updateInvoice(id, patch) { const i = getInvoice(id); if (i) { Object.assign(i, patch); persist(); } return i; }

export function audit(invoiceId, type, data = {}) {
  s().events.push({ at: new Date().toISOString(), invoiceId, type, data });
  if (s().events.length > 2000) s().events.splice(0, 500);
  persist();
}
export const auditFor = (id) => s().events.filter((e) => e.invoiceId === id);

export function budgetLeft() {
  const month = new Date().toISOString().slice(0, 7);
  const spent = s().invoices
    .filter((i) => ['PAYING', 'PAID'].includes(i.status) && i.createdAt.startsWith(month))
    .reduce((a, i) => a + i.amount, 0);
  return Math.round((s().mandate.monthlyBudget - spent) * 100) / 100;
}

export function isDuplicate(vendorName, invoiceNumber, sha) {
  const vn = norm(vendorName), no = norm(invoiceNumber);
  return s().invoices.some((i) => i.status !== 'REJECTED' && (i.sha === sha || (no && norm(i.vendorName) === vn && norm(i.invoiceNumber) === no)));
}
