// ── MCP: sidebar list ──────────────────────────────────────────────────────
function renderMcpSidebar() {
  const el = document.getElementById('mcp-sidebar-list');
  el.innerHTML = '';
  if (mcpServers.length === 0) {
    el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--muted)">No MCP servers found</div>';
    return;
  }
  for (const srv of mcpServers) {
    const item = document.createElement('div');
    item.className = 'command-sidebar-item' + (activeFilePath === srv.configFile ? ' active' : '');
    item.innerHTML = `
      <span class="command-name">${escHtml(srv.name)}</span>
      <span class="command-scope">${escHtml(srv.scope)}</span>
    `;
    item.onclick = () => { switchTab('mcp'); openFile(srv.configFile, srv.configFile.split('/').pop()); };
    el.appendChild(item);
  }
}

// ── MCP: middle panel ──────────────────────────────────────────────────────
function renderMcpPanel() {
  const el = document.getElementById('file-list');
  el.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'file-list-header';
  hdr.innerHTML = `<span>${mcpServers.length} MCP server${mcpServers.length !== 1 ? 's' : ''}</span>`;
  el.appendChild(hdr);

  if (mcpServers.length === 0) {
    el.innerHTML += `<div class="empty" style="flex:1">No MCP servers configured</div>`;
    return;
  }

  // Group by config file
  const byFile = new Map();
  for (const srv of mcpServers) {
    if (!byFile.has(srv.configFile)) byFile.set(srv.configFile, []);
    byFile.get(srv.configFile).push(srv);
  }

  for (const [configFile, servers] of byFile) {
    const groupLabel = servers[0].scopeLabel;
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `<span>${escHtml(groupLabel)}</span><span style="font-size:10px;color:var(--muted);margin-left:8px;font-weight:400;text-transform:none;letter-spacing:0">${escHtml(configFile)}</span>`;
    divider.onclick = () => openFile(configFile, configFile.split('/').pop());
    el.appendChild(divider);

    for (const srv of servers) {
      const item = document.createElement('div');
      item.className = 'mcp-server-item' + (activeFilePath === configFile ? ' active' : '');
      item.dataset.filepath = configFile;

      const cmd = srv.type === 'sse' || srv.type === 'http'
        ? (srv.url || srv.type)
        : [srv.command, ...srv.args].filter(Boolean).join(' ');

      const envBadge = srv.envKeys && srv.envKeys.length > 0
        ? `<span class="mcp-env-badge">${srv.envKeys.length} env var${srv.envKeys.length !== 1 ? 's' : ''}</span>`
        : '';

      const typeBadge = srv.type
        ? `<span class="mcp-type-badge">${escHtml(srv.type)}</span>`
        : '';

      item.innerHTML = `
        <div class="mcp-server-name">${escHtml(srv.name)}${typeBadge}${envBadge}</div>
        <div class="mcp-server-cmd">${escHtml(cmd)}</div>
      `;
      item.onclick = () => openFile(configFile, configFile.split('/').pop());
      el.appendChild(item);
    }
  }
}
