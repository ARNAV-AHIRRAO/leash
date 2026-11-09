(() => {
  const $ = (id) => document.getElementById(id);
  const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n, cur) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(n); }
    catch { return `${Number(n).toFixed(2)} ${cur || ''}`.trim(); }
  };
  const usd0 = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  // All text from invoices is untrusted: only ever set via textContent.
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };

  const VERDICT = { AUTO_PAY: ['Auto-pay', 'pass'], NEEDS_APPROVAL: ['Needs you', 'hold'], DENY: ['Refused', 'block'] };
  const STATUS = {
    PAYING: ['Paying', 'info'], PAID: ['Paid', 'pass'], AWAITING_APPROVAL: ['Waiting for you', 'hold'],
    DENIED: ['Blocked', 'block'], REJECTED: ['Rejected by you', 'block'], FAILED: ['Payment failed', 'block'],
  };
  const chip = (map, k) => { const [t, c] = map[k] || [k, 'info']; return el('span', { class: 'chip ' + c }, t); };

  let state = null, gridApi = null, openId = null, busy = false, lastSig = '';

  async function api(path, opts = {}) {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), isErr ? 6000 : 3200);
  }

  // ---------- gauge ----------
  function renderGauge() {
    const { autoLimit, hardCap } = state.mandate;
    const max = hardCap * 1.3;
    const pct = (v) => Math.min(v / max, 0.985) * 100;
    const g = $('gauge'); g.replaceChildren();
    g.append(el('div', { class: 'track' },
      el('div', { class: 'z pass', style: `width:${pct(autoLimit)}%` }),
      el('div', { class: 'z hold', style: `width:${pct(hardCap) - pct(autoLimit)}%` }),
      el('div', { class: 'z block', style: 'flex:1' })));
    for (const [v, label] of [[autoLimit, usd0(autoLimit)], [hardCap, usd0(hardCap)]]) {
      g.append(el('div', { class: 'tick', style: `left:${pct(v)}%` }), el('div', { class: 'lab', style: `left:${pct(v)}%` }, label));
    }
    g.append(el('div', { class: 'lab first', style: 'left:0' }, '$0'));
    for (const i of state.invoices) {
      g.append(el('div', { class: 'dot ' + i.status, style: `left:${pct(i.amount)}%`, title: `${i.vendorName} ${money(i.amount, i.currency)}` }));
    }
  }

  // ---------- stats ----------
  function renderStats() {
    const inv = state.invoices;
    const sum = (f) => inv.filter(f).reduce((a, i) => a + i.amount, 0);
    const stat = (v, l) => el('div', { class: 'stat' }, el('b', {}, v), el('span', {}, l));
    $('stats').replaceChildren(
      stat(usd(state.budgetLeft), 'Left in this month\'s budget'),
      stat(usd(sum((i) => ['PAYING', 'PAID'].includes(i.status))), 'Paid out'),
      stat(String(inv.filter((i) => i.status === 'AWAITING_APPROVAL').length), 'Waiting for you'),
      stat(String(inv.filter((i) => i.status === 'DENIED').length), 'Blocked'));
  }

  // ---------- grid ----------
  function actionCell(p) {
    const wrap = el('div');
    if (p.data.status === 'AWAITING_APPROVAL') {
      wrap.append(
        el('button', { class: 'btn ok sm', onclick: (e) => { e.stopPropagation(); decide(p.data.id, 'approve'); } }, 'Approve'), ' ',
        el('button', { class: 'btn no sm', onclick: (e) => { e.stopPropagation(); decide(p.data.id, 'reject'); } }, 'Reject'));
    }
    return wrap;
  }
  const COLS_KEY = 'leash.cols.v2';
  const payeeFor = (r) => state.vendors.find((v) => v.id === r.vendorId)?.paypalEmail || r.invoiceEmail || 'unknown payee';
  const totalsRow = () => {
    const paid = state.invoices.filter((i) => ['PAYING', 'PAID'].includes(i.status));
    return [{ id: 'totals', isTotal: true, vendorName: `Paid out (${paid.length})`, amount: paid.reduce((a, i) => a + i.amount, 0), currency: 'USD' }];
  };
  let saveTimer;
  const saveCols = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(gridApi.getColumnState())); } catch { } }, 300); };

  function updateBulkBar() {
    const rows = gridApi.getSelectedRows().filter((r) => r.status === 'AWAITING_APPROVAL');
    $('bulkBar').hidden = rows.length === 0;
    const total = rows.reduce((a, r) => a + r.amount, 0);
    $('bulkCount').textContent = `${rows.length} selected, ${money(total, rows[0]?.currency)} total`;
  }

  async function bulk(action) {
    const rows = gridApi.getSelectedRows().filter((r) => r.status === 'AWAITING_APPROVAL');
    if (!rows.length) return;
    const total = rows.reduce((a, r) => a + r.amount, 0);
    let msg;
    if (action === 'approve') {
      const lines = rows.slice(0, 8).map((r) => `- ${r.vendorName} ${money(r.amount, r.currency)} to ${payeeFor(r)}${r.vendorId ? '' : '  (NEW VENDOR)'}`);
      if (rows.length > 8) lines.push(`...and ${rows.length - 8} more`);
      msg = `Approve and pay ${rows.length} invoice(s), ${money(total, rows[0].currency)} in total?\n\n${lines.join('\n')}`;
    } else msg = `Reject ${rows.length} invoice(s)? Nothing will be paid.`;
    if (!confirm(msg)) return;
    try {
      const res = await api('/api/invoices/bulk', { method: 'POST', body: { action, ids: rows.map((r) => r.id) } });
      gridApi.deselectAll();
      const ok = res.results.filter((x) => x.ok).length, bad = res.results.filter((x) => !x.ok);
      toast(`${action === 'approve' ? 'Approved' : 'Rejected'} ${ok}${bad.length ? `, ${bad.length} failed: ${bad[0].error}` : ''}`, bad.length > 0);
      await refresh();
    } catch (e) { toast(e.message, true); }
  }

  function initGrid() {
    const real = (p) => p.data && !p.data.isTotal;
    gridApi = agGrid.createGrid($('grid'), {
      rowData: [],
      pinnedBottomRowData: [],
      getRowId: (p) => p.data.id,
      getRowClass: (p) => (p.data?.isTotal ? 'row-total' : 'row-' + p.data?.status),
      rowSelection: {
        mode: 'multiRow', checkboxes: true, headerCheckbox: true, selectAll: 'filtered',
        enableClickSelection: false, hideDisabledCheckboxes: true,
        isRowSelectable: (n) => n.data?.status === 'AWAITING_APPROVAL',
      },
      onSelectionChanged: updateBulkBar,
      onColumnResized: (e) => { if (e.finished) saveCols(); },
      onColumnMoved: saveCols,
      onSortChanged: saveCols,
      cellFlashDuration: 700,
      cellFadeDuration: 1300,
      defaultColDef: { sortable: true, filter: true, resizable: true },
      overlayNoRowsTemplate: '<span>No invoices yet. Choose a sample on the left to start.</span>',
      onRowClicked: (e) => {
        if (e.node.isRowPinned() || e.event?.target?.closest?.('.ag-selection-checkbox, .ag-checkbox, button')) return;
        openDrawer(e.data.id);
      },
      columnDefs: [
        { headerName: 'Time', field: 'createdAt', width: 115, valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleTimeString([], { hour12: false }) : ''), sort: 'desc' },
        { headerName: 'Vendor', field: 'vendorName', flex: 1.2, minWidth: 150 },
        { headerName: 'Invoice', field: 'invoiceNumber', width: 150 },
        {
          headerName: 'Amount', field: 'amount', width: 120, type: 'rightAligned',
          valueFormatter: (p) => money(p.value, p.data?.currency),
          cellClassRules: {
            'amt-block': (p) => real(p) && state && p.value > state.mandate.hardCap,
            'amt-hold': (p) => real(p) && state && p.value > state.mandate.autoLimit && p.value <= state.mandate.hardCap,
          },
        },
        { headerName: 'AI decision', field: 'verdict', width: 130, cellRenderer: (p) => (real(p) ? chip(VERDICT, p.value) : ''), enableCellChangeFlash: true },
        { headerName: 'Status', field: 'status', width: 160, cellRenderer: (p) => (real(p) ? chip(STATUS, p.value) : ''), enableCellChangeFlash: true },
        { headerName: 'Why', field: 'reasons', flex: 2, minWidth: 220, valueFormatter: (p) => (p.value || []).join('; '), tooltipValueGetter: (p) => (p.value || []).join('; ') },
        { headerName: '', colId: 'act', width: 170, sortable: false, filter: false, cellRenderer: (p) => (real(p) ? actionCell(p) : '') },
      ],
      tooltipShowDelay: 400,
    });
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
      if (saved) gridApi.applyColumnState({ state: saved, applyOrder: true });
    } catch { }
  }

  // ---------- drawer ----------
  async function openDrawer(id) {
    openId = id;
    const inv = await api('/api/invoices/' + id);
    const body = $('drawerBody');
    const kv = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
    body.replaceChildren(el('div', {},
      el('h3', {}, `${inv.vendorName} ${inv.invoiceNumber}`),
      el('div', {}, chip(VERDICT, inv.verdict), ' ', chip(STATUS, inv.status)),
      el('h4', {}, 'Why it was decided'),
      el('ul', { class: 'reasons' }, inv.reasons.map((r) => el('li', {}, r))),
      el('h4', {}, 'What the AI read'),
      el('dl', { class: 'kv' },
        kv('Amount', money(inv.amount, inv.currency)),
        kv('Seller tax/VAT numbers', inv.taxIds?.length ? inv.taxIds.join(', ') : 'none found'),
        kv('Says it is already paid', inv.markedPaid ? 'Yes' : 'No'),
        kv('Payee on invoice', inv.invoiceEmail || 'none'),
        kv('Instructions aimed at AI', inv.injection ? 'Yes, flagged' : 'None found'),
        kv('Read by', inv.extractor.startsWith('gemini') ? 'Gemini (' + inv.extractor.split(':')[1] + ')' : 'Built-in fallback parser'),
        kv('Summary', inv.summary || 'n/a')),
      inv.lineItems.length ? el('ul', { class: 'reasons' }, inv.lineItems.map((l) => el('li', {}, `${l.description}: ${money(l.amount, inv.currency)}`))) : null,
      el('h4', {}, 'PayPal payout'),
      el('dl', { class: 'kv' },
        kv('Paid to', inv.payout?.email || 'not paid'),
        kv('Batch ID', inv.payout?.batchId || 'n/a'),
        kv('PayPal status', inv.payout?.detail || inv.error || 'n/a')),
      inv.status === 'AWAITING_APPROVAL' ? el('div', { class: 'row' },
        el('button', { class: 'btn ok', onclick: () => decide(id, 'approve') }, 'Approve and pay'),
        el('button', { class: 'btn no', onclick: () => decide(id, 'reject') }, 'Reject')) : null,
      inv.status === 'PAYING' ? el('div', { class: 'row' }, el('button', { class: 'btn ghost', onclick: () => api(`/api/invoices/${id}/sync`, { method: 'POST' }).then(refresh) }, 'Check PayPal now')) : null,
      el('h4', {}, 'Audit trail'),
      el('ul', { class: 'audit' }, inv.audit.map((e) => el('li', {}, el('time', {}, new Date(e.at).toLocaleTimeString()), e.type.replace(/_/g, ' ')))),
      el('h4', {}, 'Document text (untrusted)'),
      el('pre', { class: 'doc' }, inv.excerpt)));
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() { openId = null; $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); }

  // ---------- actions ----------
  async function decide(id, what) {
    try { await api(`/api/invoices/${id}/${what}`, { method: 'POST' }); toast(what === 'approve' ? 'Approved. Payout sent to PayPal.' : 'Rejected. Nothing was paid.'); await refresh(); }
    catch (e) { toast(e.message, true); }
  }
  async function submit(payload, label) {
    if (busy) return; busy = true; $('sendBtn').disabled = true;
    try {
      const inv = await api('/api/invoices', { method: 'POST', body: payload });
      toast(`${label || inv.vendorName}: ${VERDICT[inv.verdict][0]}`); await refresh(); return inv;
    } catch (e) { toast(e.message, true); }
    finally { busy = false; $('sendBtn').disabled = false; }
  }

  // ---------- refresh ----------
  async function refresh() {
    state = await api('/api/state');
    const banner = $('banner');
    if (state.paypalMode === 'mock') { banner.hidden = false; banner.textContent = 'Mock mode: no PayPal credentials found, so payouts are simulated. Add PAYPAL_CLIENT_ID and PAYPAL_SECRET to use the PayPal sandbox.'; }
    else banner.hidden = true;
    $('modes').replaceChildren(el('span', {}, state.paypalMode === 'sandbox' ? 'PayPal sandbox' : 'PayPal mock'), el('span', {}, 'AI: ' + state.llm));
    const f = $('mandateForm');
    if (!f.contains(document.activeElement)) for (const k of ['autoLimit', 'hardCap', 'monthlyBudget']) f[k].value = state.mandate[k];
    renderGauge(); renderStats();
    const sig = `${state.mandate.autoLimit}/${state.mandate.hardCap}`;
    gridApi.setGridOption('rowData', state.invoices);
    gridApi.setGridOption('pinnedBottomRowData', totalsRow());
    if (sig !== lastSig) { lastSig = sig; gridApi.refreshCells({ columns: ['amount'], force: true }); }
    updateBulkBar();
    if (openId) openDrawer(openId).catch(() => { });
  }

  // ---------- wiring ----------
  async function init() {
    initGrid();
    $('drawerClose').onclick = closeDrawer;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    $('quick').oninput = (e) => gridApi.setGridOption('quickFilterText', e.target.value);
    $('bulkApprove').onclick = () => bulk('approve');
    $('bulkReject').onclick = () => bulk('reject');
    $('bulkClear').onclick = () => gridApi.deselectAll();
    $('viewBtn').onclick = () => { try { localStorage.removeItem(COLS_KEY); } catch { } gridApi.resetColumnState(); toast('View reset.'); };
    $('csvBtn').onclick = () => gridApi.exportDataAsCsv({ fileName: 'leash-ledger.csv' });

    $('mandateForm').onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      try { await api('/api/mandate', { method: 'PUT', body: { autoLimit: f.autoLimit.value, hardCap: f.hardCap.value, monthlyBudget: f.monthlyBudget.value } }); toast('Limits saved.'); await refresh(); }
      catch (err) { toast(err.message, true); }
    };

    let picked = null;
    $('invFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      $('fileName').textContent = f.name;
      const rd = new FileReader();
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        rd.onload = () => { picked = { pdfBase64: String(rd.result).split(',')[1], filename: f.name }; $('invText').value = ''; };
        rd.readAsDataURL(f);
      } else { rd.onload = () => { picked = null; $('invText').value = String(rd.result); }; rd.readAsText(f); }
    };
    $('sendBtn').onclick = async () => {
      const text = $('invText').value.trim();
      const r = await submit(text ? { text } : picked, 'Invoice');
      if (r) { $('invText').value = ''; picked = null; $('fileName').textContent = ''; $('invFile').value = ''; }
    };

    const samples = await api('/api/samples');
    $('samples').replaceChildren(...samples.map((s) => el('li', {}, el('button', { onclick: () => submit({ text: s.text, filename: s.file }, s.title) }, el('span', {}, s.title), el('small', {}, s.expect)))));
    $('runAll').onclick = async () => { for (const s of samples) { await submit({ text: s.text, filename: s.file }, s.title); await new Promise((r) => setTimeout(r, 400)); } };
    $('resetBtn').onclick = async () => { if (!confirm('Clear all invoices and restore default limits and vendors?')) return; await api('/api/reset', { method: 'POST' }); closeDrawer(); toast('Demo reset.'); refresh(); };

    await refresh();
    setInterval(() => refresh().catch(() => { }), 3000);
  }
  init().catch((e) => toast(e.message, true));
})();
