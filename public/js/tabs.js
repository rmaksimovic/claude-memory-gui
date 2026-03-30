function getActiveTab() { return openTabs.find(t => t.id === activeTabId) || null; }
function tabIdFor(type, path) { return type + ':' + path; }

function syncToActiveTab() {
  const tab = getActiveTab();
  if (!tab || tab.type !== 'file') return;
  const ta = document.querySelector('#editor-content textarea');
  if (ta) { tab.content = ta.value; activeFileContent = ta.value; }
  tab.modified = modified;
  tab.mode = editorMode;
}

function promoteTab(id) {
  const tab = openTabs.find(t => t.id === id);
  if (!tab || !tab.preview) return;
  tab.preview = false;
  renderTabBar();
  saveTabState();
}

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const tab of openTabs) {
    const item = document.createElement('div');
    item.className = 'tab-item' + (tab.id === activeTabId ? ' active' : '') + (tab.preview ? ' preview' : '');
    const icon = tab.type === 'conv' ? '<img src="claude-code-icon.png" class="tab-claude-icon" />' : '📄';
    const label = tab.type === 'conv'
      ? (tab.conv.firstUserMessage || 'Conversation').slice(0, 35)
      : tab.filename;
    item.innerHTML = `<span class="tab-icon">${icon}</span><span class="tab-label">${escHtml(label)}</span>${tab.modified ? '<span class="tab-modified">●</span>' : ''}<button class="tab-close" title="Close">×</button>`;
    item.addEventListener('click', () => activateTab(tab.id));
    item.addEventListener('dblclick', () => promoteTab(tab.id));
    item.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
    item.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
    bar.appendChild(item);
  }
}

function syncFileListActive() {
  const activePath = activeFilePath || activeConvPath || '';
  document.querySelectorAll('#file-list .file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filepath === activePath && activePath !== '');
  });
}

function activateTab(id) {
  if (id === activeTabId) return;
  syncToActiveTab();
  activeTabId = id;
  const tab = getActiveTab();
  if (!tab) return;
  if (tab.type === 'file') {
    activeFilePath = tab.filePath;
    activeConvPath = null;
    activeFileContent = tab.content;
    modified = tab.modified;
    editorMode = tab.mode;
    hideConvStatsPanel();
    renderEditor(tab.filePath, tab.filename, tab.content);
  } else {
    activeConvPath = tab.filePath;
    activeFilePath = null;
    modified = false;
    renderChatView(document.getElementById('editor-content'), tab.conv, tab.messages);
  }
  renderTabBar();
  syncFileListActive();
  saveTabState();
}

function closeTab(id) {
  const idx = openTabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = openTabs[idx];
  if (tab.modified && !confirm('Close without saving?')) return;
  if (tab.type === 'file' && tab.modified) clearTimeout(saveTimeout);
  openTabs.splice(idx, 1);
  if (activeTabId === id) {
    const next = openTabs[idx] || openTabs[idx - 1] || null;
    activeTabId = next ? next.id : null;
    const ec = document.getElementById('editor-content');
    if (!next) {
      activeFilePath = null; activeConvPath = null; modified = false;
      hideConvStatsPanel();
      ec.innerHTML = `<div class="empty">${ICON_FILE}Select a file to view</div>`;
    } else if (next.type === 'file') {
      activeFilePath = next.filePath; activeConvPath = null;
      activeFileContent = next.content; modified = next.modified; editorMode = next.mode;
      hideConvStatsPanel();
      renderEditor(next.filePath, next.filename, next.content);
    } else {
      activeConvPath = next.filePath; activeFilePath = null; modified = false;
      renderChatView(ec, next.conv, next.messages);
    }
  }
  renderTabBar();
  syncFileListActive();
  saveTabState();
}
