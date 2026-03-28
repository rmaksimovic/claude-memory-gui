// ── Conversation viewer ────────────────────────────────────────────────────
async function openConversation(conv) {
  const id = tabIdFor('conv', conv.filePath);
  const existing = openTabs.find(t => t.id === id);
  if (existing) { activateTab(id); return; }

  syncToActiveTab();
  const ec = document.getElementById('editor-content');
  ec.innerHTML = `<div class="empty">${ICON_FILE}Loading…</div>`;

  const messages = await api('GET', `/api/conversation?path=${encodeURIComponent(conv.filePath)}`);
  const tab = { id, type: 'conv', filePath: conv.filePath, filename: conv.id, conv, messages };
  openTabs.push(tab);
  activeTabId = id;
  activeConvPath = conv.filePath; activeFilePath = null; modified = false;
  renderTabBar();
  renderChatView(ec, conv, messages);
  saveTabState();
}

function renderChatView(pane, conv, messages) {
  pane.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  const userTurns = messages.filter(m => m.type === 'user' && !m.isMeta).length;
  toolbar.innerHTML = `
    <div class="editor-filename">${escHtml(conv.filePath)}</div>
    <span style="font-size:11px;color:var(--muted)">${userTurns} turns · ${escHtml(conv.model || '')}</span>
    <button class="stats-toggle-btn${statsPanelOpen ? ' active' : ''}" id="stats-toggle-btn">Cost & Tokens</button>
  `;
  pane.appendChild(toolbar);

  toolbar.querySelector('#stats-toggle-btn').addEventListener('click', () => {
    statsPanelOpen = !statsPanelOpen;
    toolbar.querySelector('#stats-toggle-btn').classList.toggle('active', statsPanelOpen);
    if (statsPanelOpen) showConvStatsPanel(messages, conv);
    else hideConvStatsPanel();
  });

  const scroll = document.createElement('div');
  scroll.className = 'chat-scroll';
  renderChatMessages(scroll, messages);
  pane.appendChild(scroll);
  scroll.scrollTop = scroll.scrollHeight;

  if (statsPanelOpen) showConvStatsPanel(messages, conv);
  else hideConvStatsPanel();
}

function renderChatMessages(scroll, messages) {
  for (const record of messages) {
    const isUser = record.type === 'user';
    const turn = document.createElement('div');
    turn.className = 'chat-turn';

    const roleEl = document.createElement('div');
    roleEl.className = 'chat-role';
    roleEl.textContent = isUser ? 'You' : 'Claude';
    turn.appendChild(roleEl);

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`;

    const content = record.message?.content;
    if (typeof content === 'string') {
      bubble.innerHTML = isUser ? `<p>${escHtml(content)}</p>` : marked.parse(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') {
          const d = document.createElement('div');
          d.className = 'md-preview';
          d.innerHTML = marked.parse(block.text || '');
          bubble.appendChild(d);
        } else if (block.type === 'tool_use') {
          const t = document.createElement('div');
          t.className = 'chat-tool';
          t.textContent = `⚙ ${block.name}`;
          t.title = JSON.stringify(block.input || {}, null, 2);
          bubble.appendChild(t);
        } else if (block.type === 'tool_result') {
          // skip
        }
      }
    }

    if (!bubble.innerHTML.trim()) continue;
    turn.appendChild(bubble);

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.textContent = record.timestamp ? new Date(record.timestamp).toLocaleString() : '';
    turn.appendChild(meta);

    scroll.appendChild(turn);
  }
}
