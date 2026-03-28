// ── Session restore ────────────────────────────────────────────────────────
async function restoreSessionState() {
  const s = loadUIState();
  if (!s.activeProjectId) return;

  // Re-select the saved project (loads files + cachedConversations)
  await selectProject(s.activeProjectId);

  // Re-open saved tabs
  const saved = s.savedTabs || [];
  for (const saved_tab of saved) {
    if (openTabs.find(t => t.id === saved_tab.id)) continue; // already open
    if (saved_tab.type === 'file') {
      try {
        const { content } = await api('GET', `/api/file?path=${encodeURIComponent(saved_tab.filePath)}`);
        openTabs.push({ id: saved_tab.id, type: 'file', filePath: saved_tab.filePath, filename: saved_tab.filename, content, modified: false, mode: saved_tab.mode || 'preview' });
      } catch {}
    } else if (saved_tab.type === 'conv') {
      const conv = cachedConversations.find(c => c.filePath === saved_tab.filePath);
      if (!conv) continue;
      try {
        const messages = await api('GET', `/api/conversation?path=${encodeURIComponent(saved_tab.filePath)}`);
        openTabs.push({ id: saved_tab.id, type: 'conv', filePath: saved_tab.filePath, filename: saved_tab.filename, conv, messages });
      } catch {}
    }
  }

  // Activate saved active tab (or first available)
  const targetId = openTabs.find(t => t.id === s.activeTabId) ? s.activeTabId : (openTabs[0]?.id || null);
  if (targetId) {
    activeTabId = targetId;
    const tab = getActiveTab();
    const ec = document.getElementById('editor-content');
    if (tab.type === 'file') {
      activeFilePath = tab.filePath; activeConvPath = null;
      activeFileContent = tab.content; modified = false; editorMode = tab.mode;
      renderEditor(tab.filePath, tab.filename, tab.content);
    } else {
      activeConvPath = tab.filePath; activeFilePath = null;
      renderChatView(ec, tab.conv, tab.messages);
    }
    renderTabBar();
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  applyGridCols();
  // Restore persisted UI state
  ['memory', 'claudemd', 'conversations'].forEach(key => {
    document.getElementById(`fp-${key}`)?.classList.toggle('active', activeFilters.has(key));
  });
  const emptyBtn = document.getElementById('toggle-empty-btn');
  if (emptyBtn) {
    emptyBtn.classList.toggle('on', showEmptyProjects);
    emptyBtn.textContent = showEmptyProjects ? 'hide empty' : 'show empty';
  }
  [projects, commands] = await Promise.all([
    api('GET', '/api/projects'),
    api('GET', '/api/commands'),
  ]);
  renderProjects();
  renderCommandSidebar();
  setupSSE();
  await restoreSessionState();
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tab-memory').classList.toggle('active', tab === 'memory');
  document.getElementById('tab-commands').classList.toggle('active', tab === 'commands');
  document.getElementById('section-memory').classList.toggle('hidden', tab !== 'memory');
  document.getElementById('section-commands').classList.toggle('hidden', tab !== 'commands');

  if (tab === 'commands') {
    renderCommandsMiddlePanel();
  } else {
    // Restore memory panel
    if (activeProjectId) {
      selectProject(activeProjectId);
    } else {
      document.getElementById('file-list').innerHTML = `<div class="empty">${ICON_FOLDER}Select a project</div>`;
    }
  }
}

// ── SSE ────────────────────────────────────────────────────────────────────
function setupSSE() {
  const es = new EventSource('/api/events');
  const dot = document.getElementById('status-dot');
  es.onopen = () => { dot.style.background = 'var(--ok)'; dot.title = 'Live sync active'; };
  es.onerror = () => { dot.style.background = 'var(--err)'; dot.title = 'Connection lost'; };
  es.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'change') {
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
  };
}

// ── Search ─────────────────────────────────────────────────────────────────
let searchDebounce = null;
const searchInput = document.getElementById('search-input');
const typeFilter = document.getElementById('type-filter');

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(doSearch, 200);
});
typeFilter.addEventListener('change', doSearch);

async function doSearch() {
  const q = searchInput.value.trim();
  const type = typeFilter.value;
  const overlay = document.getElementById('search-results');
  if (!q) { overlay.style.display = 'none'; return; }

  const results = await api('GET', `/api/search?q=${encodeURIComponent(q)}&type=${type}`);
  overlay.style.display = 'block';
  overlay.innerHTML = results.length === 0
    ? '<div style="padding:16px;color:var(--muted);font-size:13px">No results</div>'
    : results.map(r => `
      <div class="search-result-item" onclick="jumpToResult('${escAttr(r.filePath)}','${escAttr(r.filename)}','${escAttr(r.projectId)}')">
        <div class="sr-top">
          <span class="type-badge type-${r.type}">${r.type}</span>
          <span class="sr-name">${escHtml(r.name)}</span>
          <span class="sr-project">${escHtml(r.projectLabel)}</span>
        </div>
        <div class="sr-snippet">${escHtml(r.snippet)}</div>
      </div>
    `).join('');
}

async function jumpToResult(filePath, filename, projectId) {
  document.getElementById('search-results').style.display = 'none';
  searchInput.value = '';
  if (activeProjectId !== projectId) {
    switchTab('memory');
    await selectProject(projectId);
  }
  await openFile(filePath, filename);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('search-results').style.display = 'none';
    searchInput.value = '';
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
boot();

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  projects = await api('GET', '/api/projects');
  renderProjects();
  if (activeProjectId) selectProject(activeProjectId);
});
