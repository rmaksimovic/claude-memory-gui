// ── Render file list ───────────────────────────────────────────────────────
function renderFileList(proj, files, health, conversations = [], mdFiles = []) {
  const el = document.getElementById('file-list');
  el.innerHTML = '';

  const memCount = files.filter(f => f.filename !== 'MEMORY.md').length;
  const countParts = [];
  if (activeFilters.has('claudemd') && mdFiles.length) countParts.push(`${mdFiles.length} MD files`);
  if (activeFilters.has('memory')) countParts.push(`${memCount} memories`);
  if (activeFilters.has('conversations')) countParts.push(`${conversations.length} chats`);
  // ── Fixed header: search + controls (live in the col wrapper, not scroll area) ──
  const searchInp = document.getElementById('file-search-input');
  searchInp.value = fileSearchQuery;
  // Re-attach listener each render (old clone trick avoids duplicates)
  const freshSearch = searchInp.cloneNode(true);
  searchInp.replaceWith(freshSearch);
  freshSearch.value = fileSearchQuery;

  const hdr = document.getElementById('file-list-header');
  hdr.innerHTML = '';

  const sortToggle = document.createElement('div');
  sortToggle.className = 'sort-toggle';
  sortToggle.innerHTML = `
    <button class="sort-btn ${fileSort === 'alpha' ? 'active' : ''}" onclick="setFileSort('alpha', arguments[0])">A–Z</button>
    <button class="sort-btn ${fileSort === 'modified' ? 'active' : ''}" onclick="setFileSort('modified', arguments[0])">Recent</button>
  `;
  hdr.appendChild(sortToggle);

  const grpBtn = document.createElement('button');
  grpBtn.id = 'group-toggle-btn';
  grpBtn.className = 'group-toggle-btn' + (groupFiles ? ' on' : '');
  grpBtn.title = 'Toggle grouped view';
  grpBtn.innerHTML = '<span class="gtb-dot"></span>Group';
  grpBtn.onclick = toggleGroupFiles;
  grpBtn.style.marginLeft = 'auto';
  hdr.appendChild(grpBtn);

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'reload-btn';
  reloadBtn.title = 'Reload';
  reloadBtn.innerHTML = '↻';
  reloadBtn.onclick = () => { if (activeProjectId) selectProject(activeProjectId); };
  hdr.appendChild(reloadBtn);

  function applyFileSearch(q) {
    fileSearchQuery = q.toLowerCase().trim();
    const items = el.querySelectorAll('.file-item');
    items.forEach(item => {
      const match = !fileSearchQuery || item.dataset.searchtext?.includes(fileSearchQuery);
      item.style.display = match ? '' : 'none';
    });
    // Hide section dividers when all their children are hidden
    el.querySelectorAll('.section-divider').forEach(div => {
      const body = div.nextElementSibling;
      if (!body) return;
      const anyVisible = [...body.querySelectorAll('.file-item')].some(i => i.style.display !== 'none');
      div.style.display = anyVisible ? '' : 'none';
      body.style.display = anyVisible ? '' : 'none';
    });
  }

  freshSearch.addEventListener('input', e => applyFileSearch(e.target.value));

  // ── Unified file item renderer ───────────────────────────────────────────
  function makeFileItem({ filePath, name, badge, badgeClass, desc, metaLeft, mtime, isActive, searchtext, onclick, ondblclick }) {
    const item = document.createElement('div');
    item.className = 'file-item' + (isActive ? ' active' : '');
    item.innerHTML = `
      <div class="file-item-name">
        <span class="file-item-name-text">${escHtml(name)}</span>
        <span class="type-badge${badgeClass ? ' ' + badgeClass : ''}">${badge}</span>
      </div>
      ${desc ? `<div class="file-item-desc">${escHtml(desc)}</div>` : ''}
      <div class="file-item-meta">
        <span>${metaLeft ? escHtml(String(metaLeft)) : ''}</span>
        <span>${relativeTime(mtime)}</span>
      </div>
    `;
    item.onclick = onclick;
    if (ondblclick) item.ondblclick = e => { e.stopPropagation(); ondblclick(); };
    item.dataset.filepath = filePath || '';
    item.dataset.mtime = mtime || '';
    item.dataset.name = name;
    item.dataset.searchtext = searchtext;
    return item;
  }

  const makeMdFileItem   = f    => makeFileItem({ filePath: f.filePath, name: f.filename, badge: 'md', badgeClass: 'type-md', desc: f.snippet || f.description || null, metaLeft: f.lineCount ? `${f.lineCount} lines` : null, mtime: f.mtime, isActive: activeFilePath === f.filePath, searchtext: ((f.filename || '') + ' ' + (f.description || '') + ' ' + (f.snippet || '')).toLowerCase(), onclick: () => openFile(f.filePath, f.filename), ondblclick: () => openFile(f.filePath, f.filename, true) });
  const makeMemoryItem   = f    => makeFileItem({ filePath: f.filePath, name: f.name, badge: 'memory', desc: f.description || f.filename, metaLeft: `${f.lineCount} lines`, mtime: f.mtime, isActive: activeFilePath === f.filePath, searchtext: ((f.name || '') + ' ' + (f.description || '') + ' ' + (f.body || '')).toLowerCase(), onclick: () => openFile(f.filePath, f.filename), ondblclick: () => openFile(f.filePath, f.filename, true) });
  const makeConvItem     = conv => { const displayMsg = stripSystemTags(conv.firstUserMessage || '') || 'Empty conversation'; return makeFileItem({ filePath: conv.filePath, name: displayMsg, badge: 'chat', desc: conv.model || null, metaLeft: formatBytes(conv.size), mtime: conv.mtime, isActive: activeConvPath === conv.filePath, searchtext: (displayMsg + ' ' + (conv.cwd || '')).toLowerCase(), onclick: () => openConversation(conv), ondblclick: () => openConversation(conv, true) }); };

  const memoryIndex = files.find(f => f.filename === 'MEMORY.md') || null;
  const makeMemoryIndexItem = f => makeFileItem({ filePath: f.filePath, name: 'MEMORY.md', badge: 'index', badgeClass: 'type-index', desc: 'Auto-generated memory index', metaLeft: `${f.lineCount} lines`, mtime: f.mtime, isActive: activeFilePath === f.filePath, searchtext: 'memory.md index', onclick: () => openFile(f.filePath, f.filename), ondblclick: () => openFile(f.filePath, f.filename, true) });

  const sortedMemory = [...files]
    .filter(f => f.filename !== 'MEMORY.md')
    .sort((a, b) => fileSort === 'modified'
      ? new Date(b.mtime) - new Date(a.mtime)
      : a.name.localeCompare(b.name));

  const sortedConvs = [...conversations]
    .sort((a, b) => fileSort === 'modified'
      ? new Date(b.mtime) - new Date(a.mtime)
      : stripSystemTags(a.firstUserMessage || '').localeCompare(stripSystemTags(b.firstUserMessage || '')));

  const sortedMdFiles = [...mdFiles]
    .sort((a, b) => fileSort === 'modified'
      ? new Date(b.mtime) - new Date(a.mtime)
      : (a.description || a.filename).localeCompare(b.description || b.filename));

  function makeCollapsibleSection(key, label, buildItems) {
    const isCollapsed = collapsedSections.has(key);
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    const chevron = document.createElement('span');
    chevron.className = 'section-chevron';
    chevron.textContent = isCollapsed ? '›' : '⌄';
    divider.appendChild(document.createTextNode(label));
    divider.appendChild(chevron);
    const body = document.createElement('div');
    body.className = 'section-body' + (isCollapsed ? ' collapsed' : '');
    buildItems(body);
    divider.onclick = () => {
      if (collapsedSections.has(key)) collapsedSections.delete(key);
      else collapsedSections.add(key);
      const nowCollapsed = collapsedSections.has(key);
      chevron.textContent = nowCollapsed ? '›' : '⌄';
      body.classList.toggle('collapsed', nowCollapsed);
    };
    el.appendChild(divider);
    el.appendChild(body);
  }

  if (groupFiles) {
    // ── Grouped view ──────────────────────────────────────────────────────
    const activeSectionCount = [
      activeFilters.has('claudemd') && mdFiles.length > 0,
      activeFilters.has('memory'),
      activeFilters.has('conversations') && conversations.length > 0
    ].filter(Boolean).length;
    const showDividers = activeSectionCount > 1;

    if (activeFilters.has('claudemd') && mdFiles.length > 0) {
      if (showDividers) {
        makeCollapsibleSection('claudemd', `MD files · ${mdFiles.length}`, body => {
          for (const f of sortedMdFiles) body.appendChild(makeMdFileItem(f));
        });
      } else {
        for (const f of sortedMdFiles) el.appendChild(makeMdFileItem(f));
      }
    }

    if (activeFilters.has('memory')) {
      if (showDividers) {
        makeCollapsibleSection('memory', `Memory · ${memCount}`, body => {
          if (memoryIndex) body.appendChild(makeMemoryIndexItem(memoryIndex));
          for (const f of sortedMemory) body.appendChild(makeMemoryItem(f));
        });
      } else {
        if (memoryIndex) el.appendChild(makeMemoryIndexItem(memoryIndex));
        for (const f of sortedMemory) el.appendChild(makeMemoryItem(f));
      }
    }

    if (activeFilters.has('conversations') && conversations.length > 0) {
      if (showDividers) {
        makeCollapsibleSection('conversations', `Conversations · ${conversations.length}`, body => {
          for (const conv of sortedConvs) body.appendChild(makeConvItem(conv));
        });
      } else {
        for (const conv of sortedConvs) el.appendChild(makeConvItem(conv));
      }
    }
  } else {
    // ── Flat view — all items interleaved, sorted by current sort ─────────
    const allItems = [];

    if (activeFilters.has('claudemd')) {
      for (const f of mdFiles) {
        allItems.push({ el: makeMdFileItem(f), mtime: new Date(f.mtime), name: f.description || f.filename });
      }
    }
    if (activeFilters.has('memory')) {
      if (memoryIndex) allItems.push({ el: makeMemoryIndexItem(memoryIndex), mtime: new Date(memoryIndex.mtime), name: 'MEMORY.md' });
      for (const f of files.filter(f => f.filename !== 'MEMORY.md')) {
        allItems.push({ el: makeMemoryItem(f), mtime: new Date(f.mtime), name: f.name });
      }
    }
    if (activeFilters.has('conversations')) {
      for (const conv of conversations) {
        allItems.push({ el: makeConvItem(conv), mtime: new Date(conv.mtime), name: conv.firstUserMessage || '' });
      }
    }

    allItems.sort((a, b) => fileSort === 'modified'
      ? b.mtime - a.mtime
      : a.name.localeCompare(b.name));

    for (const item of allItems) el.appendChild(item.el);
  }

  // Health panel
  if (health.length > 0) {
    const hp = document.createElement('div');
    hp.className = 'health-panel';
    for (const issue of health) {
      const icon = issue.level === 'error' ? '🔴' : '🟡';
      hp.innerHTML += `<div class="health-item"><span class="health-icon">${icon}</span><span>${escHtml(issue.message)}</span></div>`;
    }
    el.appendChild(hp);
  }

  if (fileSearchQuery) applyFileSearch(fileSearchQuery);

  // Count footer (rendered outside scroll area so it sticks to bottom)
  const footerEl = document.getElementById('file-list-footer');
  const footer = footerEl || document.createElement('div');
  footer.innerHTML = '';
  const countSpan = document.createElement('span');
  countSpan.textContent = countParts.join(' · ') || 'Nothing selected';
  footer.appendChild(countSpan);
  if (proj && proj.path) {
    const pathRow = document.createElement('div');
    pathRow.className = 'file-list-footer-path-row';
    const pathSpan = document.createElement('span');
    pathSpan.className = 'file-list-footer-path';
    pathSpan.textContent = proj.path;
    pathSpan.title = proj.path;
    pathRow.appendChild(pathSpan);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-path-btn';
    copyBtn.title = 'Copy path';
    copyBtn.textContent = '⎘';
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(proj.path);
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⎘'; }, 1200);
    };
    pathRow.appendChild(copyBtn);
    footer.appendChild(pathRow);
  }
  if (!footerEl) el.appendChild(footer);
}
