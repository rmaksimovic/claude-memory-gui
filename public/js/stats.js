// ── Pricing & stats ────────────────────────────────────────────────────────

// Prices from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-03-26)
// More specific entries first (first match wins).
const PRICING = [
  { match: 'claude-opus-4-6',   input:  5.00, output: 25.00, cw5m:  6.25, cw1h: 10.00, cr: 0.50 },
  { match: 'claude-opus-4-5',   input:  5.00, output: 25.00, cw5m:  6.25, cw1h: 10.00, cr: 0.50 },
  { match: 'claude-opus-4-1',   input: 15.00, output: 75.00, cw5m: 18.75, cw1h: 30.00, cr: 1.50 },
  { match: 'claude-opus-4',     input: 15.00, output: 75.00, cw5m: 18.75, cw1h: 30.00, cr: 1.50 },
  { match: 'claude-sonnet-4',   input:  3.00, output: 15.00, cw5m:  3.75, cw1h:  6.00, cr: 0.30 },
  { match: 'claude-haiku-4-5',  input:  1.00, output:  5.00, cw5m:  1.25, cw1h:  2.00, cr: 0.10 },
  { match: 'claude-haiku-3-5',  input:  0.80, output:  4.00, cw5m:  1.00, cw1h:  1.60, cr: 0.08 },
  { match: 'claude-3-5-sonnet', input:  3.00, output: 15.00, cw5m:  3.75, cw1h:  6.00, cr: 0.30 },
  { match: 'claude-3-opus',     input: 15.00, output: 75.00, cw5m: 18.75, cw1h: 30.00, cr: 1.50 },
  { match: 'claude-3-sonnet',   input:  3.00, output: 15.00, cw5m:  3.75, cw1h:  6.00, cr: 0.30 },
  { match: 'claude-3-haiku',    input:  0.25, output:  1.25, cw5m:  0.30, cw1h:  0.50, cr: 0.03 },
];

function lookupPricing(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  return PRICING.find(p => m.includes(p.match)) || null;
}

function computeConvStats(messages) {
  let inp = 0, out = 0, cw5m = 0, cw1h = 0, cr = 0, apiCalls = 0;
  let model = '';
  for (const r of messages) {
    if (r.type !== 'assistant') continue;
    const usage = r.message?.usage;
    if (!usage) continue;
    apiCalls++;
    if (r.message?.model && !model) model = r.message.model;
    inp  += usage.input_tokens || 0;
    out  += usage.output_tokens || 0;
    cr   += usage.cache_read_input_tokens || 0;
    const cc = usage.cache_creation || {};
    const got5m = cc.ephemeral_5m_input_tokens || 0;
    const got1h = cc.ephemeral_1h_input_tokens || 0;
    if (got5m || got1h) {
      cw5m += got5m;
      cw1h += got1h;
    } else {
      // Older records without breakdown: assume 1h (most common in Claude Code)
      cw1h += usage.cache_creation_input_tokens || 0;
    }
  }

  const p = lookupPricing(model);
  const M = 1_000_000;
  let cost = null, costInp = null, costOut = null, costCw = null, costCr = null;
  let costNoCaching = null;
  if (p) {
    costInp  = inp   / M * p.input;
    costOut  = out   / M * p.output;
    costCw   = (cw5m / M * p.cw5m) + (cw1h / M * p.cw1h);
    costCr   = cr    / M * p.cr;
    cost     = costInp + costOut + costCw + costCr;
    costNoCaching = (inp + cw5m + cw1h + cr) / M * p.input + out / M * p.output;
  }

  return { inp, out, cw5m, cw1h, cr, model, apiCalls, cost, costInp, costOut, costCw, costCr, costNoCaching };
}

function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function fmtCost(n) {
  if (n == null) return '—';
  if (n === 0)   return '$0.00';
  if (n < 0.001) return '<$0.001';
  if (n < 1)     return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

function renderStatsTab(container, messages, conv) {
  const s = computeConvStats(messages);

  const savedAbs = (s.costNoCaching != null && s.cost != null) ? s.costNoCaching - s.cost : null;
  const savedPct = (savedAbs != null && s.costNoCaching > 0) ? savedAbs / s.costNoCaching * 100 : 0;

  const el = document.createElement('div');
  el.className = 'stats-scroll';

  // ── Cost summary ──
  const pricingNote = lookupPricing(s.model) ? '' : ' <span style="color:var(--warn);font-size:10px">(unknown model pricing)</span>';
  el.innerHTML += `
    <div class="stats-card">
      <div class="stats-card-title">Estimated Cost${pricingNote}</div>
      <div class="cost-total">${fmtCost(s.cost)}</div>
      <div class="cost-chips">
        <span class="cost-chip">Input <strong>${fmtCost(s.costInp)}</strong></span>
        <span class="cost-chip">Output <strong>${fmtCost(s.costOut)}</strong></span>
        <span class="cost-chip">Cache write <strong>${fmtCost(s.costCw)}</strong></span>
        <span class="cost-chip">Cache read <strong>${fmtCost(s.costCr)}</strong></span>
      </div>
    </div>
  `;

  // ── Token breakdown ──
  const rows = [
    { label: 'Input (fresh)',   tok: s.inp,  cost: s.costInp, color: '#6366f1' },
    { label: 'Cache write 5m', tok: s.cw5m, cost: s.costCw != null ? s.cw5m / 1e6 * (lookupPricing(s.model)?.cw5m || 0) : null, color: '#f59e0b' },
    { label: 'Cache write 1h', tok: s.cw1h, cost: s.costCw != null ? s.cw1h / 1e6 * (lookupPricing(s.model)?.cw1h || 0) : null, color: '#f97316' },
    { label: 'Cache read',     tok: s.cr,   cost: s.costCr,  color: '#22c55e' },
    { label: 'Output',         tok: s.out,  cost: s.costOut, color: '#3b82f6' },
  ].filter(r => r.tok > 0);

  const totalTok = rows.reduce((sum, r) => sum + r.tok, 0) || 1;

  const barSegs = rows.map(r =>
    `<div class="token-bar-seg" style="width:${(r.tok / totalTok * 100).toFixed(2)}%;background:${r.color}" title="${r.label}: ${fmtTok(r.tok)}"></div>`
  ).join('');

  const tableRows = rows.map(r => `
    <tr>
      <td><span class="tok-dot" style="background:${r.color}"></span>${r.label}</td>
      <td>${fmtTok(r.tok)}</td>
      <td>${fmtCost(r.cost)}</td>
    </tr>
  `).join('');

  el.innerHTML += `
    <div class="stats-card">
      <div class="stats-card-title">Token Breakdown</div>
      <div class="token-bar">${barSegs}</div>
      <table class="tok-table">
        <thead><tr><th>Type</th><th>Tokens</th><th>Cost</th></tr></thead>
        <tbody>
          ${tableRows}
          <tr class="tok-total">
            <td>Total</td>
            <td>${fmtTok(totalTok)}</td>
            <td>${fmtCost(s.cost)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // ── Cache savings ──
  if (savedAbs != null && savedAbs > 0.0001) {
    el.innerHTML += `
      <div class="stats-card">
        <div class="stats-card-title">Cache Savings</div>
        <div class="savings-labels">
          <span>Actual: <strong style="color:var(--text)">${fmtCost(s.cost)}</strong></span>
          <span>Saved: <strong>${fmtCost(savedAbs)}</strong> (${savedPct.toFixed(0)}%)</span>
        </div>
        <div class="savings-bar-track">
          <div class="savings-bar-fill" style="width:${Math.min(savedPct, 100).toFixed(1)}%"></div>
        </div>
        <div style="font-size:11px;color:var(--muted)">Without caching would cost ${fmtCost(s.costNoCaching)}</div>
      </div>
    `;
  }

  // ── Details ──
  el.innerHTML += `
    <div class="stats-card">
      <div class="stats-card-title">Details</div>
      <div class="stats-meta-row"><span class="label">Model</span><span>${escHtml(s.model || conv.model || '—')}</span></div>
      <div class="stats-meta-row"><span class="label">API calls</span><span>${s.apiCalls}</span></div>
      <div class="stats-meta-row"><span class="label">Started</span><span>${conv.timestamp ? new Date(conv.timestamp).toLocaleString() : '—'}</span></div>
      <div class="stats-meta-row"><span class="label">File size</span><span>${formatBytes(conv.size)}</span></div>
    </div>
  `;

  container.appendChild(el);
}

function showConvStatsPanel(messages, conv) {
  const panel = document.getElementById('conv-stats-panel');
  panel.innerHTML = '';
  panel.classList.add('visible');
  document.querySelector('.layout').classList.add('has-stats-panel');
  document.getElementById('stats-resize-handle').style.display = '';
  applyGridCols();
  const hdr = document.createElement('div');
  hdr.className = 'conv-stats-panel-header';
  hdr.textContent = 'Cost & Tokens';
  panel.appendChild(hdr);
  renderStatsTab(panel, messages, conv);
}

function hideConvStatsPanel() {
  const panel = document.getElementById('conv-stats-panel');
  panel.classList.remove('visible');
  panel.innerHTML = '';
  document.querySelector('.layout').classList.remove('has-stats-panel');
  document.getElementById('stats-resize-handle').style.display = 'none';
  applyGridCols();
}
