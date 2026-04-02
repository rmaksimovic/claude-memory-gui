// ── Message density timeline ───────────────────────────────────────────────

function buildTimelineData(messages) {
  const points = messages
    .filter(m => m.timestamp)
    .map(m => ({ ts: new Date(m.timestamp).getTime(), isUser: m.type === 'user' }))
    .filter(m => !isNaN(m.ts))
    .sort((a, b) => a.ts - b.ts);

  if (points.length < 2) return null;

  const first = points[0].ts;
  const last  = points[points.length - 1].ts;
  const span  = last - first;

  let bucketMs;
  if      (span < 30 * 60e3)      bucketMs = 2 * 60e3;
  else if (span < 3 * 3600e3)     bucketMs = 15 * 60e3;
  else if (span < 24 * 3600e3)    bucketMs = 3600e3;
  else if (span < 7 * 86400e3)    bucketMs = 6 * 3600e3;
  else if (span < 30 * 86400e3)   bucketMs = 86400e3;
  else                             bucketMs = 7 * 86400e3;

  // Pad one empty slot before and after so the chart shows silence at both ends
  const bucketStart = Math.floor(first / bucketMs) * bucketMs - bucketMs;
  const count = Math.ceil((last - bucketStart) / bucketMs) + 2;
  const buckets = Array.from({ length: count }, (_, i) => ({
    ts: bucketStart + i * bucketMs, user: 0, ai: 0,
  }));
  for (const p of points) {
    const idx = Math.floor((p.ts - bucketStart) / bucketMs);
    if (idx >= 0 && idx < buckets.length) {
      if (p.isUser) buckets[idx].user++; else buckets[idx].ai++;
    }
  }
  return { buckets, bucketMs };
}

function fmtBucketLabel(ts, bucketMs) {
  const d = new Date(ts);
  if (bucketMs < 3600e3)   return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (bucketMs < 86400e3)  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderTimelineChart(container, messages, scrollEl) {
  container.innerHTML = '';
  const data = buildTimelineData(messages);
  if (!data) {
    container.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:20px;text-align:center">No timestamp data available</div>';
    return;
  }

  const { buckets, bucketMs } = data;
  const W  = container.clientWidth || 400;
  const H  = 148;
  const mt = 10, mr = 12, mb = 26, ml = 28;
  const cW = W - ml - mr;
  const cH = H - mt - mb;

  const maxVal = Math.max(...buckets.map(b => b.user + b.ai), 1);
  const yMax   = maxVal <= 2 ? maxVal : Math.ceil(maxVal / 2) * 2;
  const yTicks = [...new Set([0, Math.ceil(yMax / 2), yMax])];

  const gap  = cW / buckets.length;
  const barW = Math.max(1, gap - Math.max(1, gap * 0.15));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));

  const cs   = getComputedStyle(document.documentElement);
  const clrAccent = cs.getPropertyValue('--accent').trim()  || '#1a3a5c';
  const clrMuted  = cs.getPropertyValue('--muted').trim()   || '#6b7280';
  const clrBorder = cs.getPropertyValue('--border').trim()  || '#2d2d2d';
  const clrAI     = '#4a7fa5';

  const ns  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.style.cssText = 'display:block;font-family:Inter,sans-serif;';

  function el(tag, attrs) {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  // Grid + Y labels
  for (const tick of yTicks) {
    const y = mt + cH - (tick / yMax) * cH;
    svg.appendChild(el('line', { x1: ml, x2: ml + cW, y1: y, y2: y,
      stroke: clrBorder, 'stroke-width': tick === 0 ? 1 : 0.5 }));
    if (tick > 0) {
      const t = el('text', { x: ml - 4, y: y + 3, 'text-anchor': 'end',
        fill: clrMuted, 'font-size': 9 });
      t.textContent = tick;
      svg.appendChild(t);
    }
  }

  // Tooltip
  const tip = document.createElement('div');
  tip.style.cssText = 'display:none;position:absolute;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:11px;color:var(--text);pointer-events:none;white-space:nowrap;z-index:50;line-height:1.5;';
  container.style.position = 'relative';
  container.appendChild(tip);

  // Bars + hit areas
  for (let i = 0; i < buckets.length; i++) {
    const b    = buckets[i];
    const x    = ml + i * gap + (gap - barW) / 2;
    const total = b.user + b.ai;

    if (b.ai > 0) {
      const aiH   = (b.ai   / yMax) * cH;
      const userH = (b.user / yMax) * cH;
      svg.appendChild(el('rect', { x, y: mt + cH - userH - aiH,
        width: barW, height: aiH, fill: clrAI, rx: 1 }));
    }
    if (b.user > 0) {
      const userH = (b.user / yMax) * cH;
      svg.appendChild(el('rect', { x, y: mt + cH - userH,
        width: barW, height: userH, fill: clrAccent, rx: 1 }));
    }

    // Invisible hit rect
    const hit = el('rect', { x: ml + i * gap, y: mt, width: gap, height: cH, fill: 'transparent' });
    if (total > 0) hit.style.cursor = 'pointer';
    const label = fmtBucketLabel(b.ts, bucketMs);

    // Click → scroll to first message in bucket
    if (total > 0 && scrollEl) {
      hit.addEventListener('click', () => {
        const bucketEnd = b.ts + bucketMs;
        const turns = scrollEl.querySelectorAll('.chat-turn[data-ts]');
        let target = null;
        for (const turn of turns) {
          const ts = +turn.dataset.ts;
          if (ts >= b.ts && ts < bucketEnd) { target = turn; break; }
        }
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.classList.add('timeline-highlight');
          setTimeout(() => target.classList.remove('timeline-highlight'), 1200);
        }
      });
    }

    hit.addEventListener('mouseenter', () => {
      if (!total) return;
      tip.innerHTML = `<strong>${escHtml(label)}</strong><br>`
        + `<span style="color:${clrAccent}">You: ${b.user}</span>`
        + ` &nbsp;<span style="color:${clrAI}">AI: ${b.ai}</span>`;
      tip.style.display = 'block';
    });
    hit.addEventListener('mousemove', e => {
      const r = container.getBoundingClientRect();
      let lx = e.clientX - r.left + 10;
      const ly = e.clientY - r.top - 44;
      if (lx + 130 > r.width) lx -= 140;
      tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
    });
    hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    svg.appendChild(hit);

    // X axis label
    if (i % labelEvery === 0 || i === buckets.length - 1) {
      const t = el('text', { x: ml + i * gap + gap / 2, y: H - 6,
        'text-anchor': 'middle', fill: clrMuted, 'font-size': 9 });
      t.textContent = label;
      svg.appendChild(t);
    }
  }

  container.appendChild(svg);

  // Legend
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:12px;padding:2px 12px 6px;justify-content:flex-end;font-size:10px;color:var(--muted);';
  legend.innerHTML = `<span><span style="display:inline-block;width:8px;height:8px;background:${clrAccent};border-radius:2px;vertical-align:middle;margin-right:4px"></span>You</span>`
    + `<span><span style="display:inline-block;width:8px;height:8px;background:${clrAI};border-radius:2px;vertical-align:middle;margin-right:4px"></span>AI</span>`;
  container.appendChild(legend);
}

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

  // Timeline toggle button
  const timelineBtn = document.createElement('button');
  timelineBtn.className = 'stats-toggle-btn';
  timelineBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">bar_chart</span> Timeline';
  let timelineOpen = false;
  header.querySelector('.conv-title-actions').appendChild(timelineBtn);

  const scroll = document.createElement('div');
  scroll.className = 'chat-scroll';
  renderChatMessages(scroll, messages, conv.filePath);
  pane.appendChild(scroll);
  scroll.scrollTop = 0;

  // Timeline panel (sits between scroll and footer, slides up)
  const timelinePanel = document.createElement('div');
  timelinePanel.className = 'timeline-panel';
  timelineBtn.addEventListener('click', () => {
    timelineOpen = !timelineOpen;
    timelineBtn.classList.toggle('active', timelineOpen);
    timelinePanel.classList.toggle('open', timelineOpen);
    if (timelineOpen) requestAnimationFrame(() => renderTimelineChart(timelinePanel, messages, scroll));
    else timelinePanel.innerHTML = '';
  });
  pane.appendChild(timelinePanel);

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
    if (record.timestamp) turn.dataset.ts = new Date(record.timestamp).getTime();

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
