// ── MCP: module state ──────────────────────────────────────────────────────
const _mcpCollapsed = new Set(); // collapsed project groups in sidebar
let activeMcpKey = null;         // 'serverName:configFile' of the selected server

function _mcpKey(srv, group) { return srv.name + ':' + group.configFile; }

// ── MCP: open server info tab ──────────────────────────────────────────────
function openMcpServer(srv, group, permanent = false) {
  const id = tabIdFor('mcp-info', _mcpKey(srv, group));
  const existing = openTabs.find(t => t.id === id);

  activeMcpKey = _mcpKey(srv, group);
  // Keep sidebar + panel highlights in sync without a full re-render
  document.querySelectorAll('.mcp-sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mcpkey === activeMcpKey);
  });
  document.querySelectorAll('.mcp-server-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mcpkey === activeMcpKey);
  });

  if (existing) {
    if (permanent && existing.preview) { existing.preview = false; renderTabBar(); saveTabState(); }
    activateTab(id);
    return;
  }

  syncToActiveTab();
  hideConvStatsPanel();

  const tab = {
    id, type: 'mcp-info', filename: srv.name,
    server: srv, group,
    preview: !permanent, modified: false,
  };

  const previewIdx = permanent ? -1 : openTabs.findIndex(t => t.preview);
  if (previewIdx !== -1) { openTabs.splice(previewIdx, 1, tab); }
  else { openTabs.push(tab); }

  activeTabId = id;
  activeFilePath = null;
  activeConvPath = null;
  renderTabBar();
  syncFileListActive();
  renderMcpInfoCard(document.getElementById('editor-content'), srv, group);
  saveTabState();
}

// ── MCP: info card renderer ────────────────────────────────────────────────
function renderMcpInfoCard(pane, srv, group) {
  pane.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'conv-header mcp-info-header';
  const scopeIcon = group.scope === 'plugin' ? 'extension' : group.scope === 'global' ? 'public' : 'folder';
  const scopeLabel = group.scope === 'plugin'
    ? `Plugin · ${group.scopeLabel}`
    : group.scope === 'global' ? 'Global' : `Project · ${group.scopeLabel}`;
  header.innerHTML = `
    <nav class="conv-breadcrumbs">
      <span>MCP Servers</span>
      <span class="material-symbols-outlined" style="font-size:14px;opacity:0.4">chevron_right</span>
      <span class="conv-breadcrumb-active">${escHtml(group.scopeLabel)}</span>
    </nav>
    <div class="conv-title-row">
      <span class="material-symbols-outlined" style="font-size:22px;color:var(--ok);margin-right:10px">${scopeIcon}</span>
      <div>
        <div class="conv-title">${escHtml(srv.name)}</div>
        <div class="conv-meta">${escHtml(scopeLabel)}</div>
      </div>
      <div class="conv-title-actions"></div>
    </div>
  `;

  // Open config file button
  if (!group.readOnly) {
    const editBtn = document.createElement('button');
    editBtn.className = 'stats-toggle-btn';
    editBtn.title = 'Open config file';
    editBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">edit</span> Config';
    editBtn.onclick = () => openFile(group.configFile, group.configFile.split('/').pop(), true);
    header.querySelector('.conv-title-actions').appendChild(editBtn);
  }

  pane.appendChild(header);

  // Info table card
  const scroll = document.createElement('div');
  scroll.className = 'md-preview-scroll';
  const card = document.createElement('div');
  card.className = 'md-preview';

  const table = document.createElement('div');
  table.className = 'mcp-info-table';

  const rows = [];
  rows.push({ key: 'Type', val: srv.type || 'stdio', badge: true });
  rows.push({ key: 'Scope', val: group.scope });
  rows.push({ key: 'Config', val: group.configFileDisplay, mono: true, title: group.configFile });
  if (group.pluginVersion) rows.push({ key: 'Version', val: group.pluginVersion });

  if (srv.url) {
    rows.push({ key: 'URL', val: srv.url, mono: true });
  } else {
    if (srv.command) rows.push({ key: 'Command', val: srv.command, mono: true });
    if (srv.args.length > 0) rows.push({ key: 'Arguments', val: srv.args.join('\n'), mono: true });
  }

  if (srv.envKeys.length > 0) {
    rows.push({ key: `Env vars (${srv.envKeys.length})`, val: srv.envKeys.join('\n'), mono: true });
  }

  for (const row of rows) {
    const keyEl = document.createElement('div');
    keyEl.className = 'mcp-info-key';
    keyEl.textContent = row.key;

    const valEl = document.createElement('div');
    valEl.className = 'mcp-info-val' + (row.mono ? ' mono' : '');
    if (row.title) valEl.title = row.title;
    if (row.badge) {
      valEl.innerHTML = `<span class="mcp-type-badge">${escHtml(row.val)}</span>`;
    } else {
      valEl.textContent = row.val;
    }

    table.appendChild(keyEl);
    table.appendChild(valEl);
  }

  card.appendChild(table);

  // Raw config snippet
  if (srv.rawConfig) {
    const snippetHdr = document.createElement('div');
    snippetHdr.className = 'mcp-snippet-hdr';
    snippetHdr.textContent = 'Config snippet';
    card.appendChild(snippetHdr);

    const pre = document.createElement('pre');
    pre.className = 'json-preview mcp-snippet';
    const snippet = { [srv.name]: srv.rawConfig };
    pre.innerHTML = jsonToHtml(JSON.stringify(snippet, null, 2));
    card.appendChild(pre);
  }

  scroll.appendChild(card);
  pane.appendChild(scroll);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'editor-footer';
  footer.appendChild(buildPathRow(group.configFile));
  pane.appendChild(footer);
}

// ── MCP: sidebar ──────────────────────────────────────────────────────────
function renderMcpSidebar() {
  const el = document.getElementById('mcp-sidebar-list');
  el.innerHTML = '';

  const groups = mcpServers;
  if (groups.length === 0) {
    el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--muted)">No MCP servers found</div>';
    return;
  }

  const globalGroups  = groups.filter(g => g.scope === 'global');
  const pluginGroups  = groups.filter(g => g.scope === 'plugin');
  const projectGroups = groups.filter(g => g.scope === 'project');

  if (globalGroups.length > 0) {
    _appendMcpSidebarSection(el, 'Global');
    for (const g of globalGroups)
      for (const srv of g.servers) _appendMcpSidebarItem(el, srv, g, false);
  }

  if (pluginGroups.length > 0) {
    _appendMcpSidebarSection(el, 'Plugins');
    for (const g of pluginGroups)
      for (const srv of g.servers) _appendMcpSidebarItem(el, srv, g, false);
  }

  if (projectGroups.length > 0) {
    _appendMcpSidebarSection(el, 'Projects');

    const byProject = new Map();
    for (const g of projectGroups) {
      const key = g.projectId || g.configFile;
      if (!byProject.has(key)) byProject.set(key, { label: g.scopeLabel, sources: [] });
      byProject.get(key).sources.push(g);
    }

    for (const [key, { label, sources }] of byProject) {
      const collapsed = _mcpCollapsed.has(key);
      const total = sources.reduce((n, g) => n + g.servers.length, 0);

      const projHdr = document.createElement('div');
      projHdr.className = 'mcp-sidebar-project-header';
      projHdr.innerHTML = `
        <span class="material-symbols-outlined mcp-chevron${collapsed ? '' : ' open'}">chevron_right</span>
        <span class="mcp-project-label">${escHtml(label)}</span>
        <span class="mcp-count-badge">${total}</span>
      `;
      projHdr.onclick = () => {
        if (_mcpCollapsed.has(key)) _mcpCollapsed.delete(key); else _mcpCollapsed.add(key);
        renderMcpSidebar();
      };
      el.appendChild(projHdr);

      if (!collapsed) {
        for (const g of sources)
          for (const srv of g.servers) _appendMcpSidebarItem(el, srv, g, true);
      }
    }
  }
}

function _appendMcpSidebarSection(el, text) {
  const hdr = document.createElement('div');
  hdr.className = 'mcp-sidebar-section-hdr';
  hdr.textContent = text;
  el.appendChild(hdr);
}

function _appendMcpSidebarItem(el, srv, group, indented) {
  const key = _mcpKey(srv, group);
  const item = document.createElement('div');
  item.className = 'mcp-sidebar-item' + (activeMcpKey === key ? ' active' : '');
  item.dataset.mcpkey = key;
  if (indented) item.classList.add('indented');

  const pluginBadge = group.readOnly ? `<span class="mcp-plugin-badge">plugin</span>` : '';
  const typeBadge = srv.type && srv.type !== 'stdio' ? `<span class="mcp-type-badge">${escHtml(srv.type)}</span>` : '';

  item.innerHTML = `
    <span class="mcp-sidebar-name">${escHtml(srv.name)}</span>
    <span class="mcp-sidebar-badges">${typeBadge}${pluginBadge}</span>
  `;
  item.onclick = () => openMcpServer(srv, group);
  el.appendChild(item);
}

// ── MCP: middle panel ──────────────────────────────────────────────────────
function renderMcpPanel() {
  const el = document.getElementById('file-list');
  el.innerHTML = '';

  const groups = mcpServers;
  const totalServers = groups.reduce((n, g) => n + g.servers.length, 0);

  const hdr = document.createElement('div');
  hdr.className = 'file-list-header';
  hdr.innerHTML = `<span>${totalServers} MCP server${totalServers !== 1 ? 's' : ''}</span>`;
  el.appendChild(hdr);

  if (groups.length === 0) {
    el.innerHTML += `<div class="empty" style="flex:1">No MCP servers configured</div>`;
    return;
  }

  const scopeOrder = ['global', 'plugin', 'project'];
  const sorted = [...groups].sort((a, b) => scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope));

  for (const group of sorted) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';

    const pluginBadge = group.scope === 'plugin'
      ? `<span class="mcp-plugin-badge" style="margin-left:6px">plugin</span>` : '';
    const versionTag = group.pluginVersion
      ? `<span class="mcp-version-tag">${escHtml(group.pluginVersion.length > 10 ? group.pluginVersion.slice(0, 8) + '…' : group.pluginVersion)}</span>` : '';

    divider.innerHTML = `
      <span>${escHtml(group.scopeLabel)}</span>${pluginBadge}${versionTag}
      <span style="flex:1"></span>
      <span class="mcp-config-path" title="${escAttr(group.configFile)}">${escHtml(group.configFileDisplay)}</span>
    `;
    el.appendChild(divider);

    for (const srv of group.servers) {
      const key = _mcpKey(srv, group);
      const item = document.createElement('div');
      item.className = 'mcp-server-item' + (activeMcpKey === key ? ' active' : '');
      item.dataset.mcpkey = key;

      const cmd = srv.url || [srv.command, ...srv.args].filter(Boolean).join(' ');
      const envBadge = srv.envKeys?.length > 0
        ? `<span class="mcp-env-badge">${srv.envKeys.length} env var${srv.envKeys.length !== 1 ? 's' : ''}</span>` : '';
      const typeBadge = srv.type && srv.type !== 'stdio'
        ? `<span class="mcp-type-badge">${escHtml(srv.type)}</span>` : '';
      const pluginBadge2 = group.readOnly ? `<span class="mcp-plugin-badge">plugin</span>` : '';

      item.innerHTML = `
        <div class="mcp-server-name">${escHtml(srv.name)}${typeBadge}${envBadge}${pluginBadge2}</div>
        <div class="mcp-server-cmd">${escHtml(cmd)}</div>
      `;
      item.onclick = () => openMcpServer(srv, group);
      el.appendChild(item);
    }
  }
}
