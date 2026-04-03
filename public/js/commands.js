// ── Skills: collapsed project groups (sidebar) ─────────────────────────────
const _skillsCollapsed = new Set();

// ── Skills: sidebar ────────────────────────────────────────────────────────
function renderSkillsSidebar() {
  const el = document.getElementById('command-sidebar-list');
  el.innerHTML = '';

  const totalCount = skills.reduce((n, g) => n + g.skills.length, 0);
  if (totalCount === 0) {
    el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--muted)">No skills found</div>';
    return;
  }

  const globalGroups  = skills.filter(g => g.scope === 'global');
  const projectGroups = skills.filter(g => g.scope === 'project');

  // ── Global
  if (globalGroups.length > 0) {
    _appendSkillsSidebarSection(el, 'Global');
    for (const g of globalGroups) _appendSkillsGroupItems(el, g, false);
  }

  // ── Projects — collapsible per-project groups
  if (projectGroups.length > 0) {
    _appendSkillsSidebarSection(el, 'Projects');

    for (const g of projectGroups) {
      const key = g.projectId || g.dir;
      const collapsed = _skillsCollapsed.has(key);

      const projHdr = document.createElement('div');
      projHdr.className = 'mcp-sidebar-project-header';
      projHdr.innerHTML = `
        <span class="material-symbols-outlined mcp-chevron${collapsed ? '' : ' open'}">chevron_right</span>
        <span class="mcp-project-label">${escHtml(g.scopeLabel)}</span>
        <span class="mcp-count-badge">${g.skills.length}</span>
      `;
      projHdr.onclick = () => {
        if (_skillsCollapsed.has(key)) _skillsCollapsed.delete(key);
        else _skillsCollapsed.add(key);
        renderSkillsSidebar();
      };
      el.appendChild(projHdr);

      if (!collapsed) _appendSkillsGroupItems(el, g, true);
    }
  }
}

function _appendSkillsSidebarSection(el, text) {
  const hdr = document.createElement('div');
  hdr.className = 'mcp-sidebar-section-hdr';
  hdr.textContent = text;
  el.appendChild(hdr);
}

function _appendSkillsGroupItems(el, group, indented) {
  // Sub-group by namespace
  const byNs = new Map();
  for (const skill of group.skills) {
    const ns = skill.namespace || '';
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns).push(skill);
  }

  for (const [ns, nsSkills] of byNs) {
    if (ns) {
      const nsHdr = document.createElement('div');
      nsHdr.className = 'skills-ns-header' + (indented ? ' indented' : '');
      nsHdr.textContent = ns;
      el.appendChild(nsHdr);
    }
    for (const skill of nsSkills) {
      const isActive = activeFilePath === skill.filePath;
      const item = document.createElement('div');
      item.className = 'mcp-sidebar-item' + (isActive ? ' active' : '') + (indented || ns ? ' indented' : '');
      item.innerHTML = `
        <span class="mcp-sidebar-name">/${escHtml(skill.name)}</span>
        <span class="mcp-sidebar-badges"><span class="command-scope">${escHtml(group.scope)}</span></span>
      `;
      item.onclick = () => { switchTab('commands'); openFile(skill.filePath, skill.name + '.md'); };
      el.appendChild(item);
    }
  }
}

// ── Skills: middle panel ───────────────────────────────────────────────────
function renderSkillsPanel() {
  const el = document.getElementById('file-list');
  el.innerHTML = '';

  const totalCount = skills.reduce((n, g) => n + g.skills.length, 0);

  const hdr = document.createElement('div');
  hdr.className = 'file-list-header';
  hdr.innerHTML = `<span>${totalCount} skill${totalCount !== 1 ? 's' : ''}</span>`;
  const newBtn = document.createElement('button');
  newBtn.className = 'btn';
  newBtn.textContent = '+ New';
  newBtn.onclick = () => openNewCommandModal();
  hdr.appendChild(newBtn);
  el.appendChild(hdr);

  if (totalCount === 0) {
    el.innerHTML += `<div class="empty" style="flex:1">${ICON_COMMAND}No skills yet</div>`;
    return;
  }

  for (const group of skills) {
    const divider = document.createElement('div');
    divider.className = 'section-divider';
    divider.innerHTML = `
      <span>${escHtml(group.scopeLabel)}</span>
      <span style="flex:1"></span>
      <span class="mcp-config-path" title="${escAttr(group.dir)}">${escHtml(group.dirDisplay)}</span>
    `;
    el.appendChild(divider);

    for (const skill of group.skills) {
      const item = document.createElement('div');
      item.className = 'mcp-server-item' + (activeFilePath === skill.filePath ? ' active' : '');
      item.dataset.filepath = skill.filePath;

      const nsBadge = skill.namespace
        ? `<span class="mcp-type-badge">${escHtml(skill.namespace)}</span>`
        : '';

      item.innerHTML = `
        <div class="mcp-server-name">/${escHtml(skill.name)}${nsBadge}</div>
        <div class="mcp-server-cmd">${escHtml(skill.description)}</div>
      `;
      item.onclick = () => openFile(skill.filePath, skill.name + '.md');
      el.appendChild(item);
    }
  }
}
