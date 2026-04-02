// ── Conversation viewer ────────────────────────────────────────────────────
async function openConversation(conv, permanent = false) {
  const id = tabIdFor('conv', conv.filePath);
  const existing = openTabs.find(t => t.id === id);
  if (existing) {
    if (permanent && existing.preview) { existing.preview = false; renderTabBar(); saveTabState(); }
    activateTab(id);
    return;
  }

  syncToActiveTab();
  const ec = document.getElementById('editor-content');
  ec.innerHTML = `<div class="empty">${ICON_FILE}Loading…</div>`;

  const messages = await api('GET', `/api/conversation?path=${encodeURIComponent(conv.filePath)}`);
  const tab = { id, type: 'conv', filePath: conv.filePath, filename: conv.id, conv, messages, preview: !permanent };

  const previewIdx = permanent ? -1 : openTabs.findIndex(t => t.preview);
  if (previewIdx !== -1) {
    openTabs.splice(previewIdx, 1, tab);
  } else {
    openTabs.push(tab);
  }
  activeTabId = id;
  activeConvPath = conv.filePath; activeFilePath = null; modified = false;
  renderTabBar();
  syncFileListActive();
  renderChatView(ec, conv, messages);
  saveTabState();
}

function renderChatView(pane, conv, messages) {
  pane.innerHTML = '';

  const userTurns = messages.filter(m => m.type === 'user' && !isSystemOnlyMessage(extractTextContent(m.message?.content))).length;

  // ── Conv header: shared structure with file editor ──
  const titleText = stripSystemTags(conv.firstUserMessage || '').slice(0, 80) || conv.id;
  const header = buildViewHeader(pane, {
    sectionLabel: 'Conversations',
    title: titleText,
    meta: `${userTurns} turns · ${escHtml(conv.model || '')}`,
  });

  const statsBtn = document.createElement('button');
  statsBtn.className = 'stats-toggle-btn' + (statsPanelOpen ? ' active' : '');
  statsBtn.id = 'stats-toggle-btn';
  statsBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">payments</span> Cost &amp; Tokens';
  statsBtn.addEventListener('click', () => {
    statsPanelOpen = !statsPanelOpen;
    statsBtn.classList.toggle('active', statsPanelOpen);
    if (statsPanelOpen) showConvStatsPanel(messages, conv);
    else hideConvStatsPanel();
  });
  header.querySelector('.conv-title-actions').appendChild(statsBtn);

  const tab = openTabs.find(t => t.filePath === conv.filePath && t.type === 'conv');
  const summarizeBtn = buildSummarizeFeature(pane, tab, conv.filePath);
  header.querySelector('.conv-title-actions').prepend(summarizeBtn);

  const scroll = document.createElement('div');
  scroll.className = 'chat-scroll';
  renderChatMessages(scroll, messages, conv.filePath);
  pane.appendChild(scroll);
  scroll.scrollTop = 0;

  // Footer: file path
  const footer = document.createElement('div');
  footer.className = 'editor-footer';
  const pathRow = document.createElement('div');
  pathRow.className = 'file-list-footer-path-row';
  const pathEl = document.createElement('span');
  pathEl.className = 'file-list-footer-path';
  pathEl.textContent = conv.filePath;
  pathEl.title = conv.filePath;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-path-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(conv.filePath);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });
  pathRow.appendChild(pathEl);
  pathRow.appendChild(copyBtn);
  footer.appendChild(pathRow);
  pane.appendChild(footer);

  if (statsPanelOpen) showConvStatsPanel(messages, conv);
  else hideConvStatsPanel();
}

// Returns the plain text from a message content (string or block array)
function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.filter(b => b.type === 'text').map(b => b.text || '').join('\n').trim();
  }
  return '';
}

function renderChatMessages(scroll, messages, filePath) {
  for (const record of messages) {
    const isUser = record.type === 'user';
    const content = record.message?.content;

    // Skip user messages that are pure system/protocol scaffolding
    if (isUser) {
      const text = extractTextContent(content);
      if (isSystemOnlyMessage(text)) continue;
    }

    // Skip assistant turns that have no text content (tool-only turns)
    if (!isUser && Array.isArray(content)) {
      const hasText = content.some(b => b.type === 'text' && (b.text || '').trim());
      if (!hasText) continue;
    }

    const turn = document.createElement('div');
    turn.className = 'chat-turn';

    const header = document.createElement('div');
    header.className = 'chat-turn-header';

    const avatarEl = document.createElement('div');
    avatarEl.className = `chat-avatar ${isUser ? 'chat-avatar-user' : 'chat-avatar-ai'}`;
    avatarEl.textContent = isUser ? 'You' : 'AI';
    header.appendChild(avatarEl);

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
          // Only show tool tags when the turn also has text (context already filtered above)
          const t = document.createElement('div');
          t.className = 'chat-tool';
          t.textContent = `⚙ ${block.name}`;
          t.title = JSON.stringify(block.input || {}, null, 2);
          bubble.appendChild(t);
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
