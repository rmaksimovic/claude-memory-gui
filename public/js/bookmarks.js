// ── File Bookmarks ──────────────────────────────────────────────────────────

function isFileBookmarked(filePath) {
  return fileBookmarks.some(b => b.filePath === filePath);
}

function toggleFileBookmark(filePath, filename, e) {
  if (e) e.stopPropagation();
  const idx = fileBookmarks.findIndex(b => b.filePath === filePath);
  if (idx !== -1) fileBookmarks.splice(idx, 1);
  else fileBookmarks.push({ filePath, filename });
  saveUIState({ fileBookmarks });
  _syncBookmarkButtons(filePath);
  if (currentTab === 'bookmarks') renderBookmarksPanel();
}

function _syncBookmarkButtons(filePath) {
  const bookmarked = isFileBookmarked(filePath);
  document.querySelectorAll('.file-bookmark-btn').forEach(btn => {
    if (btn.dataset.filepath === filePath) {
      btn.classList.toggle('bookmarked', bookmarked);
      btn.title = bookmarked ? 'Remove bookmark' : 'Bookmark';
    }
  });
  const editorBmBtn = document.getElementById('editor-bookmark-btn');
  if (editorBmBtn && activeFilePath === filePath) {
    editorBmBtn.classList.toggle('active', bookmarked);
    editorBmBtn.title = bookmarked ? 'Remove bookmark' : 'Bookmark this file';
  }
}

function renderBookmarksSidebar() {
  const list = document.getElementById('bookmarks-sidebar-list');
  if (!list) return;
  list.innerHTML = '';
  if (fileBookmarks.length === 0) {
    list.innerHTML = '<div class="bookmarks-empty-hint">No bookmarks yet</div>';
    return;
  }
  for (const bm of fileBookmarks) {
    const item = document.createElement('div');
    item.className = 'bookmark-sidebar-item' + (activeFilePath === bm.filePath ? ' active' : '');
    item.title = bm.filePath;
    const name = document.createElement('span');
    name.className = 'bookmark-sidebar-name';
    name.textContent = bm.filename.replace(/\.md$/i, '');
    item.appendChild(name);
    item.onclick = () => openFile(bm.filePath, bm.filename);
    list.appendChild(item);
  }
}

function renderBookmarksPanel() {
  const el = document.getElementById('file-list');
  el.innerHTML = '';

  const hdr = document.getElementById('file-list-header');
  hdr.innerHTML = '';
  document.getElementById('file-list-footer').innerHTML = '';

  // Wire up the search input
  const searchInp = document.getElementById('file-search-input');
  const freshSearch = searchInp.cloneNode(true);
  searchInp.replaceWith(freshSearch);
  freshSearch.value = '';

  function applySearch(q) {
    const query = q.toLowerCase().trim();
    el.querySelectorAll('.file-item').forEach(item => {
      const match = !query || item.dataset.searchtext?.includes(query);
      item.style.display = match ? '' : 'none';
    });
  }
  freshSearch.addEventListener('input', e => applySearch(e.target.value));

  if (fileBookmarks.length === 0) {
    el.innerHTML = `<div class="empty">No bookmarks yet.<br><span style="font-size:11px;color:var(--muted)">Click the bookmark icon on any file to save it here.</span></div>`;
    renderBookmarksSidebar();
    return;
  }

  for (const bm of fileBookmarks) {
    const item = document.createElement('div');
    item.className = 'file-item' + (activeFilePath === bm.filePath ? ' active' : '');
    item.dataset.filepath = bm.filePath;
    item.dataset.searchtext = (bm.filename + ' ' + bm.filePath).toLowerCase();

    const badge = bm.filename === 'MEMORY.md' ? 'index' : 'md';
    const badgeClass = bm.filename === 'MEMORY.md' ? 'type-index' : 'type-md';

    const pathParts = bm.filePath.split('/');
    const shortPath = pathParts.slice(-3).join('/');

    item.innerHTML = `
      <div class="file-item-name">
        <span class="file-item-name-text">${escHtml(bm.filename)}</span>
        <span class="type-badge ${badgeClass}">${badge}</span>
      </div>
      <div class="file-item-meta">
        <span class="bm-item-path" title="${escAttr(bm.filePath)}">…/${escHtml(shortPath)}</span>
      </div>
    `;
    item.onclick = () => openFile(bm.filePath, bm.filename);

    el.appendChild(item);
  }

  renderBookmarksSidebar();
}
