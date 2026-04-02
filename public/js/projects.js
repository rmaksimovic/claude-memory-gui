// ── Project tree building ──────────────────────────────────────────────────
function buildProjectTree(projectList) {
  const nonGlobal = projectList.filter(p => p.id !== '__global__');
  // Parse each project into path segments.
  // Prefer realPath (accurate for paths with spaces/dots) over naive encoded-ID split.
  const parsed = nonGlobal.map(p => ({
    project: p,
    segments: p.realPath
      ? p.realPath.split('/').filter(Boolean)
      : p.id.replace(/^-/, '').split('-').filter(Boolean),
  }));

  // Find common prefix to strip (home dir segments shared by all)
  let prefixLen = 0;
  if (parsed.length > 0) {
    const first = parsed[0].segments;
    outer: for (let i = 0; i < first.length - 1; i++) {
      for (const { segments } of parsed) {
        if (segments[i] !== first[i]) break outer;
      }
      prefixLen = i + 1;
    }
  }

  // Build trie from remaining segments
  const root = { children: {}, project: null };
  for (const { project, segments } of parsed) {
    const rel = segments.slice(prefixLen);
    if (rel.length === 0) continue;
    let node = root;
    for (let i = 0; i < rel.length; i++) {
      const seg = rel[i];
      if (!node.children[seg]) node.children[seg] = { children: {}, project: null };
      if (i === rel.length - 1) node.children[seg].project = project;
      node = node.children[seg];
    }
  }
  return root;
}

// Collapse single-child folders into one label (path compression)
function compressTree(node) {
  const keys = Object.keys(node.children);
  for (const key of keys) {
    compressTree(node.children[key]);
    const child = node.children[key];
    // If this folder has exactly one child and no project of its own, merge
    const childKeys = Object.keys(child.children);
    if (!child.project && childKeys.length === 1) {
      const grandKey = childKeys[0];
      const grandChild = child.children[grandKey];
      delete node.children[key];
      const mergedKey = key + '/' + grandKey;
      node.children[mergedKey] = grandChild;
    }
  }
}

// ── Bookmark helpers ───────────────────────────────────────────────────────
function toggleBookmark(id, e) {
  e.stopPropagation();
  if (bookmarks.has(id)) bookmarks.delete(id);
  else bookmarks.add(id);
  saveUIState({ bookmarks: [...bookmarks] });
  renderProjects();
}

function makePinBtn(id, parent) {
  const isPinned = bookmarks.has(id);
  const btn = document.createElement('button');
  btn.className = 'pin-btn' + (isPinned ? ' pinned' : '');
  btn.title = isPinned ? 'Remove bookmark' : 'Bookmark this project';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.textContent = 'bookmark';
  btn.appendChild(icon);
  btn.onclick = (e) => toggleBookmark(id, e);
  // Insert before count badge so pin sits left of it in the flex row
  const count = parent.querySelector('.project-count');
  if (count) parent.insertBefore(btn, count);
  else parent.appendChild(btn);
  return btn;
}

function renderPinnedSection() {
  const card = document.getElementById('pinned-card');
  const list = document.getElementById('pinned-list');
  if (!card || !list) return;

  const pinned = projects.filter(p => bookmarks.has(p.id));
  card.style.display = pinned.length === 0 ? 'none' : '';
  list.innerHTML = '';

  for (const proj of pinned) {
    const item = document.createElement('div');
    item.className = 'project-item' + (proj.id === activeProjectId ? ' active' : '');
    item.style.paddingLeft = '12px';
    const label = proj.id === '__global__' ? 'Global' : escHtml(proj.label);
    item.innerHTML = `
      <span class="project-label" title="${escAttr(proj.id)}">${label}</span>
      <span class="project-count">${visibleCount(proj)}</span>
    `;
    item.onclick = () => { switchTab('memory'); selectProject(proj.id); };
    list.appendChild(item);
  }
  applyPinnedCollapsed();
}

function togglePinnedCollapsed() {
  pinnedCollapsed = !pinnedCollapsed;
  saveUIState({ pinnedCollapsed });
  applyPinnedCollapsed();
}
function applyPinnedCollapsed() {
  document.getElementById('pinned-card')?.classList.toggle('collapsed', pinnedCollapsed);
}

function toggleDirsCollapsed() {
  dirsCollapsed = !dirsCollapsed;
  saveUIState({ dirsCollapsed });
  applyDirsCollapsed();
}
function applyDirsCollapsed() {
  document.getElementById('dirs-card')?.classList.toggle('collapsed', dirsCollapsed);
}

// ── Render projects ────────────────────────────────────────────────────────
// Track which folders have been explicitly closed (everything open by default)
const closedFolders = new Set();

function renderProjects() {
  const el = document.getElementById('project-list');
  el.innerHTML = '';

  const filtered = showEmptyProjects ? projects : projects.filter(p => p.id === '__global__' || visibleCount(p) > 0);

  renderPinnedSection();

  // Global entry at top
  const global = filtered.find(p => p.id === '__global__');
  if (global) {
    const item = document.createElement('div');
    item.className = 'project-item' + (global.id === activeProjectId ? ' active' : '');
    item.style.paddingLeft = '12px';
    item.innerHTML = `
      <span class="material-symbols-outlined project-icon">public</span>
      <span class="project-label">Global</span>
      <span class="project-count">${visibleCount(global)}</span>
    `;
    makePinBtn(global.id, item);
    item.onclick = () => { switchTab('memory'); selectProject(global.id); };
    el.appendChild(item);
  }

  // Build tree for non-global
  const tree = buildProjectTree(filtered);
  renderTreeNode(el, tree, 0, '');

  // Footer counts (across ALL projects, not just filtered)
  const footerEl = document.getElementById('tree-footer');
  if (footerEl) {
    const totalMem = projects.reduce((s, p) => s + (p.memoryCount || 0), 0);
    const totalMd = projects.reduce((s, p) => s + (p.mdFileCount || 0), 0);
    const totalConv = projects.reduce((s, p) => s + (p.conversationCount || 0), 0);
    const parts = [
      { label: `${totalMem} memories`, color: 'var(--user)' },
      { label: `${totalMd} MD files`, color: 'var(--claude_md)' },
      { label: `${totalConv} chats`, color: 'var(--project)' },
    ];
    footerEl.innerHTML = parts.map(p =>
      `<span class="tree-footer-item"><span class="tree-footer-dot" style="background:${p.color}"></span>${p.label}</span>`
    ).join('');
  }
}

function renderTreeNode(container, node, depth, pathKey) {
  const keys = Object.keys(node.children).sort();
  for (const key of keys) {
    const child = node.children[key];
    const childPath = pathKey ? pathKey + '/' + key : key;
    const hasChildren = Object.keys(child.children).length > 0;
    const isOpen = !closedFolders.has(childPath);
    const indent = 12 + depth * 14;

    if (hasChildren) {
      // Folder row
      const folder = document.createElement('div');
      folder.className = 'tree-folder';

      const row = document.createElement('div');
      row.className = 'tree-folder-row';
      row.style.paddingLeft = indent + 'px';
      row.innerHTML = `
        <span class="material-symbols-outlined tree-chevron${isOpen ? ' open' : ''}">chevron_right</span>
        <span class="material-symbols-outlined project-icon">folder</span>
        <span class="tree-folder-label">${escHtml(key)}</span>
      `;
      // Chevron-only collapse/expand
      row.querySelector('.tree-chevron').onclick = (e) => {
        e.stopPropagation();
        if (closedFolders.has(childPath)) closedFolders.delete(childPath);
        else closedFolders.add(childPath);
        renderProjects();
      };
      // Row click selects the project if this folder is one — never collapses
      row.onclick = () => {
        if (child.project) { switchTab('memory'); selectProject(child.project.id); }
      };
      folder.appendChild(row);

      // If this folder IS also a project, add a click target
      if (child.project) {
        const proj = child.project;
        row.title = proj.id;
        // Count badge on the folder row
        const badge = document.createElement('span');
        badge.className = 'project-count';
        badge.textContent = visibleCount(proj);
        row.appendChild(badge);
        makePinBtn(proj.id, row);
        row.classList.toggle('active-folder', proj.id === activeProjectId);
      }

      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children' + (isOpen ? ' open' : '');
      childrenEl.style.setProperty('--guide-x', (indent + 7) + 'px');
      renderTreeNode(childrenEl, child, depth + 1, childPath);
      folder.appendChild(childrenEl);
      container.appendChild(folder);
    } else {
      // Leaf project item
      const proj = child.project;
      if (!proj) continue;
      const item = document.createElement('div');
      item.className = 'project-item' + (proj.id === activeProjectId ? ' active' : '');
      item.style.paddingLeft = (indent + 20) + 'px';
      item.innerHTML = `
        <span class="material-symbols-outlined project-icon">folder_open</span>
        <span class="project-label" title="${escHtml(proj.id)}">${escHtml(key)}</span>
        <span class="project-count">${visibleCount(proj)}</span>
      `;
      makePinBtn(proj.id, item);
      item.onclick = () => { switchTab('memory'); selectProject(proj.id); };
      container.appendChild(item);
    }
  }
}

// ── Select project ─────────────────────────────────────────────────────────
async function selectProject(id) {
  document.getElementById('file-list').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  document.getElementById('file-list-footer').innerHTML = '';

  if (id !== activeProjectId) { cachedHealth = []; cachedConversations = []; cachedMdFiles = []; fileSearchQuery = ''; }
  activeProjectId = id;
  saveUIState({ activeProjectId });
  renderProjects();

  const proj = projects.find(p => p.id === id);
  const fetches = [
    api('GET', `/api/projects/${id}/memories`),
    api('GET', `/api/projects/${id}/health`),
    activeFilters.has('conversations') ? api('GET', `/api/projects/${id}/conversations`) : Promise.resolve([]),
    activeFilters.has('claudemd') ? api('GET', `/api/projects/${id}/mdfiles`) : Promise.resolve([]),
  ];
  const results = await Promise.allSettled(fetches);
  // Guard against race: if another project was selected while fetching, discard stale results
  if (activeProjectId !== id) return;
  const settled = (i, fallback) => results[i].status === 'fulfilled' ? results[i].value : fallback;
  files = settled(0, []);
  cachedHealth = settled(1, []);
  cachedConversations = settled(2, []);
  cachedMdFiles = settled(3, []);
  if (results.some(r => r.status === 'rejected')) {
    console.warn('[selectProject] some fetches failed:', results.filter(r => r.status === 'rejected').map(r => r.reason));
  }
  renderFileList(proj, files, cachedHealth, cachedConversations, cachedMdFiles);

  // Refresh content of any open file tabs that belong to this project
  for (const tab of openTabs) {
    if (tab.type !== 'file' || tab.modified) continue;
    try {
      const { content } = await api('GET', `/api/file?path=${encodeURIComponent(tab.filePath)}`);
      tab.content = content;
      if (tab.id === activeTabId) {
        activeFileContent = content;
        renderEditor(tab.filePath, tab.filename, content);
      }
    } catch (e) {
      console.warn('[selectProject] failed to refresh tab:', tab.filePath, e.message);
    }
  }
}

// ── Visible count per project (respects active filters, uses cached data) ──
function visibleCount(proj) {
  let n = 0;
  if (activeFilters.has('memory')) n += proj.memoryCount || 0;
  if (activeFilters.has('claudemd')) n += proj.mdFileCount || 0;
  if (activeFilters.has('conversations')) n += proj.conversationCount || 0;
  return n;
}

// ── Content type filter ────────────────────────────────────────────────────
async function toggleFilter(key) {
  if (activeFilters.has(key)) {
    if (activeFilters.size === 1) return;
    activeFilters.delete(key);
  } else {
    activeFilters.add(key);
    if (key === 'conversations' && activeProjectId && cachedConversations.length === 0) {
      cachedConversations = await api('GET', `/api/projects/${activeProjectId}/conversations`);
    }
  }
  saveUIState({ activeFilters: [...activeFilters] });
  document.getElementById(`fp-${key}`).classList.toggle('active', activeFilters.has(key));
  renderProjects(); // cheap — uses cached projects array, no server call
  if (activeProjectId) {
    const proj = projects.find(p => p.id === activeProjectId);
    renderFileList(proj, files, cachedHealth, cachedConversations, cachedMdFiles);
  }
}

// ── File sort ──────────────────────────────────────────────────────────────
async function setFileSort(mode, e) {
  e.stopPropagation();
  fileSort = mode;
  saveUIState({ fileSort });
  if (activeProjectId) await selectProject(activeProjectId);
}

// ── Group toggle ───────────────────────────────────────────────────────────
function toggleGroupFiles() {
  groupFiles = !groupFiles;
  saveUIState({ groupFiles });
  const btn = document.getElementById('group-toggle-btn');
  if (btn) btn.classList.toggle('on', groupFiles);
  const proj = projects.find(p => p.id === activeProjectId);
  if (proj) renderFileList(proj, files, cachedHealth, cachedConversations, cachedMdFiles);
}

// ── Filter panel collapse toggle ───────────────────────────────────────────
function toggleFiltersCollapsed() {
  filtersCollapsed = !filtersCollapsed;
  saveUIState({ filtersCollapsed });
  applyFiltersCollapsed();
}
function applyFiltersCollapsed() {
  document.getElementById('filter-section')?.classList.toggle('collapsed', filtersCollapsed);
}

// ── Show-empty toggle ──────────────────────────────────────────────────────
function toggleShowEmpty() {
  showEmptyProjects = !showEmptyProjects;
  saveUIState({ showEmptyProjects });
  document.getElementById('toggle-empty-btn')?.classList.toggle('active', showEmptyProjects);
  renderProjects();
}
