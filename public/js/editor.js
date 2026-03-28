// ── Editor mode: 'preview' | 'edit' ───────────────────────────────────────
let editorMode = 'preview';
let activeFileContent = '';

// ── Open file ──────────────────────────────────────────────────────────────
async function openFile(filePath, filename) {
  const id = tabIdFor('file', filePath);
  const existing = openTabs.find(t => t.id === id);
  if (existing) { activateTab(id); return; }

  syncToActiveTab();
  hideConvStatsPanel();
  const { content } = await api('GET', `/api/file?path=${encodeURIComponent(filePath)}`);
  const tab = { id, type: 'file', filePath, filename, content, modified: false, mode: editorMode };
  openTabs.push(tab);
  activeTabId = id;
  activeFilePath = filePath; activeConvPath = null;
  activeFileContent = content; modified = false;
  renderTabBar();
  renderEditor(filePath, filename, content);
  saveTabState();

  if (currentTab === 'commands') {
    renderCommandsMiddlePanel();
    renderCommandSidebar();
  }
}

// ── Render editor ──────────────────────────────────────────────────────────
function renderEditor(filePath, filename, content) {
  const pane = document.getElementById('editor-content');
  pane.innerHTML = '';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';

  const fnEl = document.createElement('div');
  fnEl.className = 'editor-filename';
  fnEl.id = 'editor-filename';
  fnEl.textContent = filePath;

  const blameBtn = document.createElement('button');
  blameBtn.className = 'group-toggle-btn' + (blameGutterVisible ? ' on' : '');
  blameBtn.innerHTML = '<span class="gtb-dot"></span>Blame';
  blameBtn.style.display = 'none';
  blameBtn.onclick = () => {
    blameGutterVisible = !blameGutterVisible;
    saveUIState({ blameGutterVisible });
    blameBtn.classList.toggle('on', blameGutterVisible);
    pane.classList.toggle('blame-hidden', !blameGutterVisible);
  };

  toolbar.appendChild(fnEl);
  toolbar.appendChild(blameBtn);
  pane.appendChild(toolbar);
  pane.classList.toggle('blame-hidden', !blameGutterVisible);

  // Git info bar (async — inserts itself when ready)
  const gitBar = document.createElement('div');
  gitBar.className = 'git-info-bar';
  pane.appendChild(gitBar);
  api('GET', `/api/gitinfo?path=${encodeURIComponent(filePath)}`).then(info => {
    if (!info || !gitBar.isConnected) return;
    const ago = relativeTime(new Date(info.timestamp));
    const ts = new Date(info.timestamp);
    const dateStr = ts.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const timeStr = ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    gitBar.innerHTML = `<span class="git-hash">${escHtml(info.hash)}</span><span class="git-subject">${escHtml(info.subject)}</span><span class="git-meta">${escHtml(info.author)} · ${dateStr} ${timeStr} (${ago})</span>`;
    gitBar.classList.add('loaded');
    blameBtn.style.display = '';
  }).catch(() => {});

  renderPreview(pane, content, filePath);
}

function setEditorMode(mode, filePath, filename) {
  // If switching away from edit, capture current textarea content
  if (editorMode === 'edit' && mode === 'preview') {
    const ta = document.querySelector('textarea');
    if (ta) activeFileContent = ta.value;
  }
  editorMode = mode;
  renderEditor(filePath, filename, activeFileContent);
}

// ── Preview renderer ───────────────────────────────────────────────────────
function buildFrontmatterBlock(fmContent) {
  const fmBlock = document.createElement('div');
  fmBlock.className = 'md-frontmatter';
  for (const line of fmContent.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    const row = document.createElement('div');
    row.className = 'md-frontmatter-row';
    row.innerHTML = `<span class="md-frontmatter-key">${escHtml(key)}</span><span class="md-frontmatter-val">${escHtml(val)}</span>`;
    fmBlock.appendChild(row);
  }
  return fmBlock;
}

function blameRelative(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
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

function blameDate(ts) {
  return `<span class="bd-rel">${blameRelative(ts)}</span>`;
}

function blameLineCount(raw) {
  const n = (raw.match(/\n/g) || []).length;
  return n + (raw.endsWith('\n') ? 0 : 1);
}

function renderBlameGrid(grid, body, lineOffset, blame, skipFirstCell = false) {
  const tokens = marked.lexer(body);
  let line = lineOffset;
  const pairs = [];

  for (const token of tokens) {
    const lc = blameLineCount(token.raw);
    if (token.type === 'space') { line += lc; continue; }

    let latest = 0;
    for (let i = line; i < line + lc && i < blame.length; i++) {
      if (blame[i]?.timestamp > latest) latest = blame[i].timestamp;
    }

    const dateCell = document.createElement('div');
    dateCell.className = 'blame-date-cell';
    if (latest) {
      dateCell.innerHTML = blameDate(latest);
      dateCell.dataset.blamekey = String(latest);
      dateCell.title = new Date(latest).toLocaleString();
    }

    const contentCell = document.createElement('div');
    contentCell.className = 'blame-content-cell md-preview';
    contentCell.innerHTML = marked.parse(token.raw);

    pairs.push([dateCell, contentCell]);
    line += lc;
  }

  if (pairs.length) {
    if (!skipFirstCell) {
      pairs[0][0].classList.add('first-cell');
      pairs[0][1].classList.add('first-cell');
    }
    pairs[pairs.length - 1][0].classList.add('last-cell');
    pairs[pairs.length - 1][1].classList.add('last-cell');
  }
  for (const [d, c] of pairs) { grid.appendChild(d); grid.appendChild(c); }

  // Click to highlight all rows with the same date value
  grid.addEventListener('click', e => {
    const cell = e.target.closest('.blame-date-cell');
    if (!cell || !cell.dataset.blamekey) return;
    const val = cell.dataset.blamekey;
    const allDate = grid.querySelectorAll('.blame-date-cell');
    const wasSelected = cell.classList.contains('blame-selected');
    allDate.forEach(c => c.classList.remove('blame-selected'));
    if (!wasSelected) allDate.forEach(c => { if (c.dataset.blamekey === val) c.classList.add('blame-selected'); });
  });
}

function renderPreview(pane, content, filePath) {
  const scroll = document.createElement('div');
  scroll.className = 'md-preview-scroll';
  const div = document.createElement('div');
  div.className = 'md-preview';

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const body = fmMatch ? fmMatch[2] : content;
  const fmLineCount = fmMatch ? fmMatch[1].split('\n').length + 2 : 0;

  if (fmMatch) {
    div.appendChild(buildFrontmatterBlock(fmMatch[1]));
    div.insertAdjacentHTML('beforeend', marked.parse(body));
  } else {
    div.innerHTML = marked.parse(content);
  }

  scroll.appendChild(div);
  pane.appendChild(scroll);

  if (!filePath) return;
  api('GET', `/api/blame?path=${encodeURIComponent(filePath)}`).then(blame => {
    if (!blame || !scroll.isConnected) return;
    // Replace card wrapper with gutter-left layout directly in scroll
    scroll.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'blame-grid';
    if (fmMatch) {
      const fmDateCell = document.createElement('div');
      fmDateCell.className = 'blame-date-cell first-cell';
      const fmContentCell = document.createElement('div');
      fmContentCell.className = 'blame-content-cell md-preview first-cell';
      fmContentCell.style.paddingBottom = '8px';
      const fmBlock = buildFrontmatterBlock(fmMatch[1]);
      fmBlock.style.border = 'none';
      fmBlock.style.background = 'none';
      fmBlock.style.padding = '0';
      fmBlock.style.margin = '0';
      fmContentCell.appendChild(fmBlock);
      grid.appendChild(fmDateCell);
      grid.appendChild(fmContentCell);
    }
    renderBlameGrid(grid, body, fmLineCount, blame, !!fmMatch);
    scroll.appendChild(grid);
  }).catch(() => {});
}

// ── Textarea editor ────────────────────────────────────────────────────────
function renderTextarea(pane, content) {
  const ta = document.createElement('textarea');
  ta.value = content;
  ta.spellcheck = false;
  ta.oninput = () => {
    modified = true;
    activeFileContent = ta.value;
    const tab = getActiveTab();
    if (tab) { tab.content = ta.value; tab.modified = true; }
    document.getElementById('editor-filename').classList.add('modified');
    renderTabBar();
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveFile, 2000);
  };
  ta.onkeydown = e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = s + 2;
    }
  };
  pane.appendChild(ta);
  ta.focus();
}

// ── Save ───────────────────────────────────────────────────────────────────
async function saveFile() {
  if (!activeFilePath) return;
  clearTimeout(saveTimeout);
  // Capture latest textarea value if in edit mode
  const ta = document.querySelector('textarea');
  if (ta) activeFileContent = ta.value;
  await api('PUT', '/api/file', { filePath: activeFilePath, content: activeFileContent });
  modified = false;
  const tab = getActiveTab();
  if (tab) { tab.modified = false; tab.content = activeFileContent; }
  document.getElementById('editor-filename')?.classList.remove('modified');
  renderTabBar();

  if (currentTab === 'memory' && activeProjectId) {
    await selectProject(activeProjectId);
    projects = await api('GET', '/api/projects');
    renderProjects();
  } else if (currentTab === 'commands') {
    commands = await api('GET', '/api/commands');
    renderCommandsMiddlePanel();
    renderCommandSidebar();
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────
async function deleteFile(filePath) {
  if (!confirm(`Delete ${filePath.split('/').pop()}?`)) return;
  await api('DELETE', '/api/file', { filePath });
  const deletedId = tabIdFor('file', filePath);
  const deletedTab = openTabs.find(t => t.id === deletedId);
  if (deletedTab) { deletedTab.modified = false; closeTab(deletedId); }

  if (currentTab === 'memory' && activeProjectId) {
    await selectProject(activeProjectId);
  } else if (currentTab === 'commands') {
    commands = await api('GET', '/api/commands');
    renderCommandsMiddlePanel();
    renderCommandSidebar();
  }
}
