// ── State ──────────────────────────────────────────────────────────────────
let projects = [];
let commands = [];
let activeProjectId = null;
let activeFilePath = null;
let files = [];
let modified = false;
let saveTimeout = null;
let currentTab = 'memory'; // 'memory' | 'commands'
let activeConvPath = null;
let statsPanelOpen = true; // remembers toggle state across conversations
let cachedHealth = [];
let cachedConversations = [];
let cachedMdFiles = [];
let fileSearchQuery = '';

// ── Tabs ───────────────────────────────────────────────────────────────────
let openTabs = [];
let activeTabId = null;

// ── Persisted UI state ─────────────────────────────────────────────────────
const UI_STORAGE_KEY = 'memgui_ui';
function loadUIState() {
  try { return JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveUIState(patch) {
  const s = loadUIState();
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ ...s, ...patch }));
}
function saveTabState() {
  const tabsToSave = openTabs.map(t => ({
    id: t.id, type: t.type, filePath: t.filePath, filename: t.filename, mode: t.mode || 'preview',
  }));
  saveUIState({ savedTabs: tabsToSave, activeTabId, activeProjectId });
}
const _ui = loadUIState();
let fileSort = _ui.fileSort ?? 'modified';
let groupFiles = _ui.groupFiles ?? true;
let showEmptyProjects = _ui.showEmptyProjects ?? true;
let activeFilters = new Set(_ui.activeFilters ?? ['memory', 'claudemd', 'conversations']);
let blameGutterVisible = _ui.blameGutterVisible ?? true;
const collapsedSections = new Set(); // 'alpha' | 'modified'
