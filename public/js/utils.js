// ── SVG icons ──────────────────────────────────────────────────────────────
const ICON_FOLDER = `<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 7a2 2 0 0 1 2-2h3.586a1 1 0 0 1 .707.293L10.414 6.5A1 1 0 0 0 11.121 6.793H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
</svg>`;

const ICON_FILE = `<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="16" y1="13" x2="8" y2="13"/>
  <line x1="16" y1="17" x2="8" y2="17"/>
  <line x1="10" y1="9" x2="8" y2="9"/>
</svg>`;

const ICON_COMMAND = `<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="4 17 10 11 4 5"/>
  <line x1="12" y1="19" x2="20" y2="19"/>
</svg>`;

// ── Utils ──────────────────────────────────────────────────────────────────
function relativeTime(mtime, verbose = false) {
  const diff = Date.now() - new Date(mtime).getTime();
  const mins = Math.floor(diff / 60000);
  if (!verbose) {
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }
  // verbose: used for blame gutter labels
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days} days ago`;
  if (days < 14) return 'last week';
  const wks = Math.floor(days / 7);
  if (days < 30) return `${wks} weeks ago`;
  const mos = Math.floor(days / 30);
  if (mos === 1)  return 'last month';
  if (mos < 12)  return `${mos} months ago`;
  const yrs = Math.floor(mos / 12);
  return `${yrs} year${yrs === 1 ? '' : 's'} ago`;
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/'/g,"\\'");
}

// ── Conversation message filtering ─────────────────────────────────────────
// Remove XML protocol tags injected by Claude Code (e.g. <local-command-caveat>,
// <command-name>, <system-reminder>). Returns the remaining human-readable text.
// Handles both complete <tag>...</tag> pairs and orphaned opening tags (truncated content).
// Backend equivalent: stripXmlTags() in lib/conversations.js
function stripSystemTags(text) {
  return String(text)
    .replace(/<[a-z][a-z0-9-]*(?:\s[^>]*)?>[\s\S]*?<\/[a-z][a-z0-9-]*>/gi, '') // paired tags
    .replace(/<[a-z][a-z0-9-]*(?:\s[^>]*)?>[\s\S]*/gi, '')                      // orphaned openers
    .trim();
}

// Returns true when the message is entirely internal Claude Code scaffolding.
function isSystemOnlyMessage(text) {
  return stripSystemTags(text) === '';
}

// ── Shared summarize feature (summary panel + button, works for any file) ────
// Appends the summary panel to pane and returns the Summarize button so the
// caller can place it in .conv-title-actions. filePath drives the API endpoint:
// .jsonl → /api/summarize-conversation, everything else → /api/summarize-file.
function buildSummarizeFeature(pane, tab, filePath) {
  function normaliseSummary(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(l => /^[•·▪▸\-]/.test(l) ? '- ' + l.replace(/^[•·▪▸\-]\s*/, '') : l).join('\n');
  }

  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'conv-summary-panel';
  summaryPanel.style.display = 'none';
  pane.appendChild(summaryPanel);

  function showSummary(text) {
    summaryPanel.innerHTML = `
      <div class="conv-summary-header">
        <span class="conv-summary-title">✦ Summary</span>
        <button class="conv-summary-close" title="Dismiss">×</button>
      </div>
      <div class="conv-summary-body">${marked.parse(normaliseSummary(text))}</div>
    `;
    summaryPanel.style.display = '';
    summaryPanel.querySelector('.conv-summary-close').addEventListener('click', () => {
      summaryPanel.style.display = 'none';
      if (tab) tab.summary = null;
    });
  }

  if (tab?.summary) showSummary(tab.summary);

  const endpoint = filePath.endsWith('.jsonl') ? '/api/summarize-conversation' : '/api/summarize-file';
  const btn = document.createElement('button');
  btn.className = 'summarize-btn';
  btn.textContent = '✦ Summarize';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Summarizing…';
    summaryPanel.style.display = 'none';
    try {
      const { summary } = await api('POST', endpoint, { filePath });
      if (tab) tab.summary = summary;
      showSummary(summary);
    } catch (e) {
      summaryPanel.innerHTML = `<div class="conv-summary-error">Failed: ${escHtml(e.message)}</div>`;
      summaryPanel.style.display = '';
    } finally {
      btn.disabled = false;
      btn.textContent = '✦ Summarize';
    }
  });

  return btn;
}

// ── Frontmatter parser ─────────────────────────────────────────────────────
// Parses YAML-style frontmatter delimited by ---. Returns { fmContent, body,
// fmLineCount, type, name, description } — fmContent is null when absent.
function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fmContent: null, body: content, fmLineCount: 0, type: null, name: null, description: null };
  const fmContent = m[1];
  const body = m[2];
  const fmLineCount = fmContent.split('\n').length + 2;
  const get = key => (fmContent.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1]?.trim() ?? null;
  return { fmContent, body, fmLineCount, type: get('type'), name: get('name'), description: get('description') };
}

// ── Collapsible section helpers ────────────────────────────────────────────
// Generic toggle/apply pair for any sidebar section persisted to localStorage.
// key: localStorage key (e.g. 'pinnedCollapsed'), elementId: DOM element id.
function toggleCollapsible(key, elementId, defaultVal = false) {
  const current = loadUIState()[key] ?? defaultVal;
  const next = !current;
  saveUIState({ [key]: next });
  document.getElementById(elementId)?.classList.toggle('collapsed', next);
}
function applyCollapsible(key, elementId, defaultVal = false) {
  const val = loadUIState()[key] ?? defaultVal;
  document.getElementById(elementId)?.classList.toggle('collapsed', val);
}

// ── Path row builder ───────────────────────────────────────────────────────
// Returns a .file-list-footer-path-row div with path label + copy button.
// Used by editor footer, conversation footer, and file-list footer.
function buildPathRow(filePath) {
  const row = document.createElement('div');
  row.className = 'file-list-footer-path-row';
  const pathEl = document.createElement('span');
  pathEl.className = 'file-list-footer-path';
  pathEl.textContent = filePath;
  pathEl.title = filePath;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-path-btn';
  copyBtn.title = 'Copy path';
  copyBtn.textContent = '⎘';
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(filePath);
    copyBtn.textContent = '✓';
    setTimeout(() => { copyBtn.textContent = '⎘'; }, 1200);
  };
  row.appendChild(pathEl);
  row.appendChild(copyBtn);
  return row;
}

// ── Shared view header (used by both file editor and conversation view) ──────
// Builds the .conv-header element (breadcrumbs + large title + actions slot)
// and appends it to pane. Returns the header element so callers can append
// their own action buttons into header.querySelector('.conv-title-actions').
function buildViewHeader(pane, { sectionLabel, title, meta }) {
  const proj = projects.find(p => p.id === activeProjectId);
  const projLabel = proj ? (proj.label || proj.id.replace(/^-/, '').split('-').pop()) : '…';
  const sep = `<span class="material-symbols-outlined" style="font-size:14px;opacity:0.4">chevron_right</span>`;
  // proj.label may contain '/' (e.g. "Golden Phoneix/FEHS") — render each segment separately
  const projCrumbs = projLabel.split('/').map(s => `<span>${escHtml(s)}</span>`).join(sep);
  const header = document.createElement('div');
  header.className = 'conv-header';
  header.innerHTML = `
    <nav class="conv-breadcrumbs">
      <span>Projects</span>${sep}${projCrumbs}${sep}
      <span class="conv-breadcrumb-active">${escHtml(sectionLabel)}</span>
    </nav>
    <div class="conv-title-row">
      <h2 class="conv-title">${escHtml(title)}</h2>
      <div class="conv-title-actions"></div>
    </div>
    <div class="conv-meta">${meta}</div>
  `;
  pane.appendChild(header);
  return header;
}
