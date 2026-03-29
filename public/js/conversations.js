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

  // Look up the tab so we can persist the summary across tab switches
  const tab = openTabs.find(t => t.filePath === conv.filePath && t.type === 'conv');

  function normaliseSummary(text) {
    // Claude often returns "• bullet" lines — convert to markdown list so marked renders them as <li>
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const mdLines = lines.map(l => /^[•·▪▸\-]/.test(l) ? '- ' + l.replace(/^[•·▪▸\-]\s*/, '') : l);
    return mdLines.join('\n');
  }

  function showSummary(text) {
    summaryPanel.innerHTML = `
      <div class="conv-summary-header">
        <span class="conv-summary-title">✦ Summary</span>
        <button class="conv-summary-close" title="Dismiss">×</button>
      </div>
      <div class="conv-summary-body">${marked.parse(normaliseSummary(text))}</div>
    `;
    summaryPanel.style.display = '';
    summaryPanel.querySelector('.conv-summary-close').addEventListener('click', () => {
      summaryPanel.style.display = 'none';
      if (tab) tab.summary = null;
    });
  }

  // Summary panel
  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'conv-summary-panel';
  summaryPanel.style.display = 'none';
  pane.appendChild(summaryPanel);

  // Restore summary if it was already generated for this tab
  if (tab?.summary) showSummary(tab.summary);

  // Summarize button
  const summarizeBtn = document.createElement('button');
  summarizeBtn.className = 'summarize-btn';
  summarizeBtn.textContent = '✦ Summarize';
  summarizeBtn.addEventListener('click', async () => {
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = 'Summarizing…';
    summaryPanel.style.display = 'none';
    try {
      const { summary } = await api('POST', '/api/summarize-conversation', { filePath: conv.filePath });
      if (tab) tab.summary = summary;
      showSummary(summary);
    } catch (e) {
      summaryPanel.innerHTML = `<div class="conv-summary-error">Failed: ${escHtml(e.message)}</div>`;
      summaryPanel.style.display = '';
    } finally {
      summarizeBtn.disabled = false;
      summarizeBtn.textContent = '✦ Summarize';
    }
  });
  toolbar.appendChild(summarizeBtn);

  const scroll = document.createElement('div');
  scroll.className = 'chat-scroll';
  renderChatMessages(scroll, messages, conv.filePath);
  pane.appendChild(scroll);
  scroll.scrollTop = scroll.scrollHeight;

  if (statsPanelOpen) showConvStatsPanel(messages, conv);
  else hideConvStatsPanel();
}

function renderChatMessages(scroll, messages, filePath) {
  for (const record of messages) {
    const isUser = record.type === 'user';
    const turn = document.createElement('div');
    turn.className = 'chat-turn';

    const header = document.createElement('div');
    header.className = 'chat-turn-header';

    const roleEl = document.createElement('div');
    roleEl.className = 'chat-role';
    roleEl.textContent = isUser ? 'You' : 'Claude';
    header.appendChild(roleEl);

    if (filePath && record.uuid) {
      const forkBtn = document.createElement('button');
      forkBtn.className = 'chat-fork-btn';
      forkBtn.title = 'Fork conversation from here';
      forkBtn.textContent = '⎇ Fork from here';
      forkBtn.addEventListener('click', () => forkFromMessage(filePath, record.uuid));
      header.appendChild(forkBtn);
    }

    turn.appendChild(header);

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

async function forkFromMessage(filePath, beforeMessageUuid) {
  const result = await api('POST', '/api/fork-conversation', { filePath, beforeMessageUuid });
  if (!result) return;

  const cmd = `claude --resume ${result.newSessionId}`;

  // Show modal with resume command
  const overlay = document.createElement('div');
  overlay.className = 'fork-modal-overlay';
  overlay.innerHTML = `
    <div class="fork-modal">
      <div class="fork-modal-title">⎇ Conversation forked</div>
      <p class="fork-modal-desc">A new conversation file has been created with the history up to this point. Resume it with:</p>
      <div class="fork-cmd-row">
        <code class="fork-cmd">${escHtml(cmd)}</code>
        <button class="fork-copy-btn" title="Copy">Copy</button>
      </div>
      <p class="fork-modal-path" title="${escHtml(result.newFilePath)}">${escHtml(result.newFilePath)}</p>
      <button class="fork-modal-close">Done</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.fork-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(cmd);
    overlay.querySelector('.fork-copy-btn').textContent = 'Copied!';
  });
  overlay.querySelector('.fork-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}
