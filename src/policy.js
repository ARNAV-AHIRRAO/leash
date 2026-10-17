// The only place payment decisions are made. Pure function, no LLM, no I/O.
// The model reads documents; this code decides money.

const usd = (n) => `$${Number(n).toFixed(2)}`;

export function decide(i, m) {
  const deny = [];
  const ask = [];

  if (i.duplicate) deny.push('Duplicate invoice (same vendor and invoice number, or same document)');
  if (!i.currencyAllowed) deny.push(`Currency ${i.currency} is not allowed by the mandate`);
  if (!(i.amount > 0)) deny.push('Invoice total is missing or not a positive number');
  if (i.sumMismatch) deny.push('Line items do not add up to the invoice total');
  if (i.amount > m.hardCap) deny.push(`Amount is over the hard cap of ${usd(m.hardCap)}`);
  if (i.amount > i.budgetLeft) deny.push(`Amount exceeds the remaining monthly budget of ${usd(Math.max(i.budgetLeft, 0))}`);

  if (i.vendorKnown && i.invoiceEmail && i.vendorEmail && i.invoiceEmail.toLowerCase() !== i.vendorEmail.toLowerCase()) {
    deny.push('Payee email on the invoice does not match the vendor on file');
  }
  if (i.taxConflict) deny.push(i.taxConflict);
  if (i.taxMismatchVendor) deny.push(i.taxMismatchVendor);
  if (!i.vendorKnown && !i.invoiceEmail) deny.push('New vendor and no payee email on the invoice to review');

  if (!i.vendorKnown) ask.push('New vendor: a person must confirm the payee');
  if (i.amount > m.autoLimit) ask.push(`Amount is over the auto-pay limit of ${usd(m.autoLimit)}`);
  if (i.vendorMedian && i.amount > 3 * i.vendorMedian) ask.push('Amount is more than 3x this vendor\'s usual invoice');
  if (i.markedPaid) ask.push('Document says it is already paid: check before paying again');
  if (i.injection) ask.push('Document contains instructions aimed at an AI');

  if (deny.length) return { verdict: 'DENY', reasons: [...deny, ...ask] };
  if (ask.length) return { verdict: 'NEEDS_APPROVAL', reasons: ask };
  return { verdict: 'AUTO_PAY', reasons: ['Known vendor, payee matches, within the mandate'] };
}
