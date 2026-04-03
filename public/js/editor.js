// ── Editor mode: 'preview' | 'edit' ───────────────────────────────────────
let editorMode = 'preview';
let activeFileContent = '';

// ── File type detection ────────────────────────────────────────────────────
function fileType(filePath) {
  if (!filePath) return 'md';
  const ext = filePath.split('.').pop().toLowerCase();
  if (ext === 'json') return 'json';
  return 'md';
}

// ── Open file ──────────────────────────────────────────────────────────────
async function openFile(filePath, filename, permanent = false) {
  const id = tabIdFor('file', filePath);
  const existing = openTabs.find(t => t.id === id);
  if (existing) {
    if (permanent && existing.preview) { existing.preview = false; renderTabBar(); saveTabState(); }
    activateTab(id);
    return;
  }

  syncToActiveTab();
  hideConvStatsPanel();
  const { content } = await api('GET', `/api/file?path=${encodeURIComponent(filePath)}`);
  const tab = { id, type: 'file', filePath, filename, content, modified: false, mode: editorMode, preview: !permanent };

  // Replace the existing preview tab in-place (keeps its position in the bar)
  const previewIdx = permanent ? -1 : openTabs.findIndex(t => t.preview);
  if (previewIdx !== -1) {
    openTabs.splice(previewIdx, 1, tab);
  } else {
    openTabs.push(tab);
  }
  activeTabId = id;
  activeFilePath = filePath; activeConvPath = null;
  activeFileContent = content; modified = false;
  renderTabBar();
  syncFileListActive();
  renderEditor(filePath, filename, content);
  saveTabState();

  if (currentTab === 'commands') {
    renderSkillsPanel();
    renderSkillsSidebar();
  }
}

// ── Render editor ──────────────────────────────────────────────────────────
function renderEditor(filePath, filename, content) {
  const pane = document.getElementById('editor-content');
  pane.innerHTML = '';

  // Build meta line: extract frontmatter type + line count
  const { type: fmType, name: fmName } = parseFrontmatter(content);
  const lineCount = content.split('\n').length;
  const metaParts = [fmType ? escHtml(fmType) + ' memory' : null, `${lineCount} lines`].filter(Boolean);

  const header = buildViewHeader(pane, {
    sectionLabel: 'Files',
    title: fmName || filename.replace(/\.[^.]+$/, ''),
    meta: metaParts.join(' · '),
  });

  const tab = openTabs.find(t => t.filePath === filePath && t.type === 'file');
  const summarizeBtn = buildSummarizeFeature(pane, tab, filePath);
  header.querySelector('.conv-title-actions').prepend(summarizeBtn);

  const bookmarkBtn = document.createElement('button');
  bookmarkBtn.id = 'editor-bookmark-btn';
  const isBookmarked = isFileBookmarked(filePath);
  bookmarkBtn.className = 'stats-toggle-btn' + (isBookmarked ? ' active' : '');
  bookmarkBtn.title = isBookmarked ? 'Remove bookmark' : 'Bookmark this file';
  bookmarkBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">bookmark</span>';
  bookmarkBtn.onclick = () => toggleFileBookmark(filePath, filename);
  header.querySelector('.conv-title-actions').prepend(bookmarkBtn);

  const blameBtn = document.createElement('button');
  blameBtn.className = 'stats-toggle-btn' + (blameGutterVisible ? ' active' : '');
  blameBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">history</span> Blame';
  blameBtn.style.display = 'none';
  blameBtn.onclick = () => {
    blameGutterVisible = !blameGutterVisible;
    saveUIState({ blameGutterVisible });
    blameBtn.classList.toggle('active', blameGutterVisible);
    pane.classList.toggle('blame-hidden', !blameGutterVisible);
  };
  header.querySelector('.conv-title-actions').appendChild(blameBtn);
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
    if (fileType(filePath) !== 'json') blameBtn.style.display = '';
  }).catch(() => {});

  renderPreview(pane, content, filePath);

  // Footer: file path
  const footer = document.createElement('div');
  footer.className = 'editor-footer';
  footer.appendChild(buildPathRow(filePath));
  pane.appendChild(footer);
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

function blameDate(ts) {
  return `<span class="bd-rel">${relativeTime(ts, true)}</span>`;
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
  if (fileType(filePath) === 'json') {
    renderJsonPreview(pane, content);
    return;
  }
  renderMarkdownPreview(pane, content, filePath);
}

function renderJsonPreview(pane, content) {
  const scroll = document.createElement('div');
  scroll.className = 'md-preview-scroll';
  const card = document.createElement('div');
  card.className = 'md-preview';
  const pre = document.createElement('pre');
  pre.className = 'json-preview';

  let formatted;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }

  pre.innerHTML = jsonToHtml(formatted);
  card.appendChild(pre);
  scroll.appendChild(card);
  pane.appendChild(scroll);
}

function jsonToHtml(json) {
  // HTML-escape first, then apply colour spans.
  // After escaping, JSON string delimiters become &quot; — match those.
  const escaped = escHtml(json);
  return escaped.replace(
    /(&quot;(?:[^&\\]|\\.)*&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match, str, colon, kw, num) => {
      if (str !== undefined) {
        const cls = colon ? 'json-key' : 'json-str';
        return `<span class="${cls}">${str}</span>${colon || ''}`;
      }
      if (kw !== undefined) return `<span class="json-kw">${kw}</span>`;
      if (num !== undefined) return `<span class="json-num">${num}</span>`;
      return match;
    }
  );
}

function renderMarkdownPreview(pane, content, filePath) {
  const scroll = document.createElement('div');
  scroll.className = 'md-preview-scroll';
  const div = document.createElement('div');
  div.className = 'md-preview';

  const { fmContent, body, fmLineCount } = parseFrontmatter(content);

  if (fmContent) {
    div.appendChild(buildFrontmatterBlock(fmContent));
    div.insertAdjacentHTML('beforeend', marked.parse(body));
  } else {
    div.innerHTML = marked.parse(content);
  }

  scroll.appendChild(div);
  pane.appendChild(scroll);
  scroll.scrollTop = 0;
  requestAnimationFrame(() => { scroll.scrollTop = 0; });

  if (!filePath) return;
  api('GET', `/api/blame?path=${encodeURIComponent(filePath)}`).then(blame => {
    if (!blame || !scroll.isConnected) return;
    const savedScrollTop = scroll.scrollTop;
    scroll.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'blame-grid';
    if (fmContent) {
      const fmDateCell = document.createElement('div');
      fmDateCell.className = 'blame-date-cell first-cell';
      const fmContentCell = document.createElement('div');
      fmContentCell.className = 'blame-content-cell md-preview first-cell';
      fmContentCell.style.paddingBottom = '8px';
      const fmBlock = buildFrontmatterBlock(fmContent);
      fmBlock.style.border = 'none';
      fmBlock.style.background = 'none';
      fmBlock.style.padding = '0';
      fmBlock.style.margin = '0';
      fmContentCell.appendChild(fmBlock);
      grid.appendChild(fmDateCell);
      grid.appendChild(fmContentCell);
    }
    renderBlameGrid(grid, body, fmLineCount, blame, !!fmContent);
    scroll.appendChild(grid);
    scroll.scrollTop = savedScrollTop;
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
    if (tab) {
      tab.content = ta.value; tab.modified = true;
      if (tab.preview) { tab.preview = false; renderTabBar(); }
    }
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
    skills = await api('GET', '/api/skills');
    renderSkillsPanel();
    renderSkillsSidebar();
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
    skills = await api('GET', '/api/skills');
    renderSkillsPanel();
    renderSkillsSidebar();
  }
}
