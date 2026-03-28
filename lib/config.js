'use strict';

// ── Pricing table (USD per million tokens) ─────────────────────────────────

// More specific entries must come before less specific ones (first match wins).
// Prices from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-03-26)
// cw5m = 5-minute cache write, cw1h = 1-hour cache write, cr = cache read (per MTok)
const MODEL_PRICING = [
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

// ── Project MD file scanner exclusions ────────────────────────────────────

const MD_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'vendor',
  'coverage', '.cache', 'out', '.svelte-kit', 'target', '__pycache__',
  '.venv', 'venv', 'env', '.tox', 'bower_components', '.expo', 'Pods',
  '.gradle', 'DerivedData', '.build',
]);

module.exports = { MODEL_PRICING, MD_EXCLUDE_DIRS };
