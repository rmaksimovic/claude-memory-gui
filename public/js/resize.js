// ── Panel widths & resize ──────────────────────────────────────────────────
const colWidthDefaults = { sidebar: 220, filelist: 280, stats: 405 };
const savedWidths = JSON.parse(localStorage.getItem('colWidths') || 'null');
const colWidths = savedWidths ? { ...colWidthDefaults, ...savedWidths } : { ...colWidthDefaults };

function applyGridCols() {
  const layout = document.querySelector('.layout');
  const hasStats = layout.classList.contains('has-stats-panel');
  layout.style.gridTemplateColumns =
    `${colWidths.sidebar}px 2px ${colWidths.filelist}px 2px 1fr` +
    (hasStats ? ` 2px ${colWidths.stats}px` : '');
  // Keep header brand column in sync with sidebar width
  const header = document.querySelector('header');
  if (header) header.style.gridTemplateColumns = `${colWidths.sidebar}px 1fr auto`;
}

document.addEventListener('mousedown', e => {
  const grip = e.target.closest('.resize-grip');
  if (!grip) return;
  const handle = grip.closest('.resize-handle');
  if (!handle) return;
  e.preventDefault();
  const col = handle.dataset.col;
  const startX = e.clientX;
  const startW = colWidths[col];
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const onMove = e => {
    const delta = e.clientX - startX;
    colWidths[col] = col === 'stats'
      ? Math.max(180, startW - delta)
      : Math.max(140, startW + delta);
    applyGridCols();
  };
  const onUp = () => {
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('colWidths', JSON.stringify(colWidths));
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});
