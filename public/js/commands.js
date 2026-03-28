// ── Commands: sidebar ──────────────────────────────────────────────────────
function renderCommandSidebar() {
  const el = document.getElementById('command-sidebar-list');
  el.innerHTML = '';
  if (commands.length === 0) {
    el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--muted)">No commands found</div>';
    return;
  }
  for (const cmd of commands) {
    const item = document.createElement('div');
    item.className = 'command-sidebar-item' + (activeFilePath === cmd.filePath ? ' active' : '');
    item.innerHTML = `
      <span class="command-name">/${escHtml(cmd.name)}</span>
      <span class="command-scope">${escHtml(cmd.scope)}</span>
    `;
    item.onclick = () => { switchTab('commands'); openFile(cmd.filePath, cmd.name + '.md'); };
    el.appendChild(item);
  }
}

// ── Commands: middle panel ─────────────────────────────────────────────────
function renderCommandsMiddlePanel() {
  const el = document.getElementById('file-list');
  el.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'file-list-header';
  hdr.innerHTML = `<span>${commands.length} command${commands.length !== 1 ? 's' : ''}</span>`;
  const newBtn = document.createElement('button');
  newBtn.className = 'btn';
  newBtn.textContent = '+ New';
  newBtn.onclick = () => openNewCommandModal();
  hdr.appendChild(newBtn);
  el.appendChild(hdr);

  if (commands.length === 0) {
    el.innerHTML += `<div class="empty" style="flex:1">${ICON_COMMAND}No commands yet</div>`;
    return;
  }

  for (const cmd of commands) {
    const item = document.createElement('div');
    item.className = 'command-detail' + (activeFilePath === cmd.filePath ? ' active' : '');
    item.innerHTML = `
      <div class="command-detail-name">/${escHtml(cmd.name)}</div>
      <div class="command-detail-scope">${escHtml(cmd.scopeLabel)} · ${escHtml(cmd.filePath)}</div>
      <div class="command-detail-desc">${escHtml(cmd.description)}</div>
    `;
    item.onclick = () => openFile(cmd.filePath, cmd.name + '.md');
    el.appendChild(item);
  }
}
