import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leash-db-'));
const db = await import('../src/db.js');

test('persist survives transient Windows-style rename locks (EPERM)', () => {
  const real = fs.renameSync;
  let fails = 3;
  fs.renameSync = (...a) => { if (fails-- > 0) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); return real(...a); };
  try {
    db.reset();
    db.addVendor({ name: 'Lock Test Co', paypalEmail: 'x@y.test' });
  } finally { fs.renameSync = real; }
  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8'));
  assert.ok(onDisk.vendors.some((v) => v.name === 'Lock Test Co'));
});

test('persist falls back to a direct write if rename keeps failing', () => {
  const real = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };
  try { db.addVendor({ name: 'Fallback Co', paypalEmail: 'f@y.test' }); } finally { fs.renameSync = real; }
  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8'));
  assert.ok(onDisk.vendors.some((v) => v.name === 'Fallback Co'));
});
