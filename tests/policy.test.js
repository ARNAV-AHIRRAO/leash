import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/policy.js';

const m = { autoLimit: 200, hardCap: 1000, monthlyBudget: 3000 };
const base = {
  amount: 84, currency: 'USD', currencyAllowed: true, budgetLeft: 3000, duplicate: false, sumMismatch: false,
  injection: false, vendorKnown: true, vendorMedian: 80, invoiceEmail: 'a@x.test', vendorEmail: 'a@x.test',
};
const run = (o) => decide({ ...base, ...o }, m);

test('routine known-vendor invoice auto-pays', () => assert.equal(run({}).verdict, 'AUTO_PAY'));
test('over auto limit needs approval', () => assert.equal(run({ amount: 520, vendorMedian: 450 }).verdict, 'NEEDS_APPROVAL'));
test('new vendor needs approval', () => assert.equal(run({ vendorKnown: false, vendorEmail: null }).verdict, 'NEEDS_APPROVAL'));
test('new vendor without payee email is denied', () => assert.equal(run({ vendorKnown: false, vendorEmail: null, invoiceEmail: null }).verdict, 'DENY'));
test('over 3x vendor median needs approval', () => assert.equal(run({ amount: 190, vendorMedian: 50 }).verdict, 'NEEDS_APPROVAL'));
test('injection never auto-pays', () => assert.equal(run({ injection: true }).verdict, 'NEEDS_APPROVAL'));
test('duplicate is denied', () => assert.equal(run({ duplicate: true }).verdict, 'DENY'));
test('over hard cap is denied', () => assert.equal(run({ amount: 1500 }).verdict, 'DENY'));
test('over remaining budget is denied', () => assert.equal(run({ budgetLeft: 50 }).verdict, 'DENY'));
test('payee email mismatch is denied', () => assert.equal(run({ invoiceEmail: 'evil@x.test' }).verdict, 'DENY'));
test('payee comparison ignores case', () => assert.equal(run({ invoiceEmail: 'A@X.TEST' }).verdict, 'AUTO_PAY'));
test('sum mismatch is denied', () => assert.equal(run({ sumMismatch: true }).verdict, 'DENY'));
test('disallowed currency is denied', () => assert.equal(run({ currencyAllowed: false, currency: 'EUR' }).verdict, 'DENY'));
test('zero or NaN amount is denied', () => { assert.equal(run({ amount: 0 }).verdict, 'DENY'); assert.equal(run({ amount: NaN }).verdict, 'DENY'); });
test('deny beats ask and keeps both reasons', () => {
  const r = run({ amount: 9400, injection: true });
  assert.equal(r.verdict, 'DENY');
  assert.ok(r.reasons.some((x) => /hard cap/.test(x)) && r.reasons.some((x) => /instructions aimed at an AI/.test(x)));
});

test('conflicting seller tax numbers are denied', () => assert.equal(run({ taxConflict: 'Seller shows 2 different tax/VAT numbers (A vs B)' }).verdict, 'DENY'));
test('tax number differing from vendor on file is denied', () => assert.equal(run({ taxMismatchVendor: 'Tax/VAT number differs' }).verdict, 'DENY'));
test('document marked already paid needs approval', () => assert.equal(run({ markedPaid: true }).verdict, 'NEEDS_APPROVAL'));
