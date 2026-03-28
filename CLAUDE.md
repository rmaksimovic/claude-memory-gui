# CLAUDE.md — Developer Guide for Claude Memory GUI

This file is intended for LLM sessions working on this codebase. It captures architecture decisions, non-obvious patterns, conventions, and gotchas that are not evident from reading the code alone.

---

## What This Project Is

A local web GUI (Node.js + vanilla JS) for managing Claude Code memory files, browsing conversations, viewing project MD files, and inspecting memory health. It reads from `~/.claude/` directly — no database, no build step.

**Stack:** Express 5, chokidar, marked.js (CDN), vanilla JS (global scope scripts), plain CSS with custom properties.

**Port:** `3737` always. No config file.

---

## File Structure

```
server.js              — Thin Express entry point (~190 lines). Only routes live here.
lib/                   — Backend modules (CommonJS, require/module.exports)
  config.js            — MODEL_PRICING table, MD_EXCLUDE_DIRS
  paths.js             — CLAUDE_DIR, PROJECTS_DIR, path encoding/decoding
  fileUtils.js         — File I/O primitives, frontmatter parsing, directory helpers
  projects.js          — listProjects(), listMemoryFiles(), buildSearchIndex()
  health.js            — syncMemoryIndex(), healthCheck()
  conversations.js     — parseConversationMeta(), listConversations(), parseFullConversation()
  commands.js          — GLOBAL_COMMANDS_DIR, PLANS_DIR, listCommands()
  git.js               — gitInfoHandler(), blameHandler() (req/res handlers)
  sse.js               — setupSSE(app), broadcast(), chokidar watcher
public/
  index.html           — Pure HTML markup (~165 lines). No inline JS or CSS.
  styles.css           — All CSS in one file (~1100 lines), with section comments
  js/                  — Frontend modules (plain globals, loaded in order via <script> tags)
    utils.js           — relativeTime(), formatBytes(), escHtml(), escAttr(), ICON_* constants
    resize.js          — Drag-to-resize panel logic
    stats.js           — Conversation cost/token stats panel
    api.js             — api(method, url, body) — single fetch wrapper
    state.js           — All global state vars + localStorage persistence
    tabs.js            — Tab bar: open/close/activate tabs, syncFileListActive()
    projects.js        — Project tree rendering, selectProject(), filter/sort toggles
    files.js           — renderFileList() and all nested file-item helpers
    editor.js          — openFile(), renderEditor(), blame grid, renderPreview(), saveFile()
    commands.js        — renderCommandSidebar(), renderCommandsMiddlePanel()
    conversations.js   — openConversation(), renderChatView(), renderChatMessages()
    modals.js          — openNewFileModal(), openNewCommandModal()
    boot.js            — boot(), restoreSessionState(), setupSSE(), search, init call
```

---

## Frontend Architecture

### No build step, no modules — global scope only

All JS files are loaded as plain `<script src="...">` tags in order. Every function and variable is in `window` scope. There is **no bundler, no ES module system, no TypeScript**. When adding new JS, just declare at top level and it's available everywhere.

Load order in `index.html` (must be preserved):
```
marked → utils → resize → stats → api → state → tabs → projects → files → editor → commands → conversations → modals → boot
```

`boot.js` is last because it calls `boot()` which depends on everything else.

### State management (state.js)

All mutable state is in global `let` variables in `state.js`. Key ones:

| Variable | Purpose |
|---|---|
| `projects` | Array of project objects from `/api/projects` |
| `openTabs` | Array of tab objects `{id, type, filePath, filename, content, modified, mode, conv, messages}` |
| `activeTabId` | ID of the currently visible tab |
| `activeFilePath` | Path of the currently open file (null if conv tab active) |
| `activeConvPath` | Path of the currently open conversation |
| `activeProjectId` | ID of the selected project in the sidebar |
| `cachedConversations` | Populated by selectProject(), used by restoreSessionState() |
| `blameGutterVisible` | Persisted to localStorage — whether the blame column is visible |
| `activeFilters` | Set of active filter keys: `'memory'`, `'claudemd'`, `'conversations'` |

### localStorage persistence

Key: `memgui_ui`. Managed by `saveUIState(patch)` / `loadUIState()` in `state.js`. Always use `saveUIState({ key: value })` to patch — never overwrite the whole object.

Persisted keys:
- `savedTabs` — array of serialised tab objects
- `activeTabId` — which tab was active
- `activeProjectId` — which project was selected
- `fileSort` — `'modified'` | `'alpha'`
- `groupFiles` — boolean
- `showEmptyProjects` — boolean
- `activeFilters` — array (deserialised into a Set)
- `blameGutterVisible` — boolean

Session is restored in `restoreSessionState()` (called at end of `boot()`). It re-fetches content for each saved tab from the server — tabs are never cached in localStorage directly.

### Tab system

Tab IDs are `type + ':' + filePath` (via `tabIdFor()`). Two tab types:
- `'file'` — memory files, MD files, CLAUDE.md
- `'conv'` — conversation viewer

`syncToActiveTab()` must be called before switching away from a tab to capture textarea content into `openTabs`.

`syncFileListActive()` updates the `.active` class on file list items by matching `el.dataset.filepath` against `activeFilePath || activeConvPath`. Every `makeFileItem()` call must set `data-filepath` on the item element.

### File list items — unified renderer

All file list items go through `makeFileItem(descriptor)` in `files.js`. The descriptor shape:
```js
{
  filePath,       // string — used for data-filepath and tab identity
  name,           // display name
  badge,          // optional badge text
  badgeClass,     // CSS class for badge
  desc,           // secondary description line
  metaLeft,       // left-aligned metadata
  mtime,          // Date — shown as relative time on the right
  isActive,       // boolean — pre-set active class
  searchtext,     // data-searchtext for client-side filter
  onclick,        // click handler
}
```

Three one-liner wrappers exist: `makeMdFileItem`, `makeMemoryItem`, `makeConvItem`.

---

## Backend Architecture

### Path encoding

Claude Code stores project directories under `~/.claude/projects/` using an encoded path:
- Forward slashes `/` → hyphens `-`
- Dots `.` → hyphens `-`
- Leading hyphen stripped

`encodeProjectPath(absPath)` encodes. `realProjectPath(encoded)` reverses using `os.homedir()` as an anchor — see `lib/paths.js` for the exact algorithm. **Do not simplify this** — the dot-replacement makes naive reversal ambiguous.

Project IDs used in API routes are these encoded paths (e.g. `-Users-alice-Documents-myapp`).

### Git integration

`/api/gitinfo?path=<abs>` — returns `{ hash, author, timestamp, subject }` or `null` if file is not git-tracked.

`/api/blame?path=<abs>` — returns array of `{ timestamp, author }` per line, or `null`.

Both run `git -C <dir>` so they work for any file in any git repo, not just `~/.claude/`.

**The blame button in the UI is hidden by default and only shown when `/api/gitinfo` returns non-null.** This is intentional — don't show it for files outside git repos.

### Blame grid rendering (editor.js)

The blame gutter uses a CSS grid: `grid-template-columns: min-content 1fr`. Each markdown block from `marked.lexer()` gets one row — a date cell (left) and a content cell (right).

Key helpers:
- `blameLineCount(raw)` — counts lines in a marked token's raw text. Formula: `n + (raw.endsWith('\n') ? 0 : 1)`. Do not simplify.
- `renderBlameGrid(grid, body, lineOffset, blame)` — `lineOffset` is the number of frontmatter lines (including the two `---` delimiters) so blame indices align with body content.
- `data-blamekey` on each date cell stores the raw timestamp string for click-to-highlight matching (not textContent, which contains HTML).

CSS classes for card borders: `first-cell` and `last-cell` are added to the first/last pairs to give the unified card rounded corners. The `.blame-hidden` class on `#editor-content` hides the date column and collapses to a single-card layout.

### SSE live sync

`GET /api/events` — Server-Sent Events stream. `lib/sse.js` uses chokidar to watch `~/.claude/` and broadcasts `{ type: 'change', path }` on any `.md` file change.

The frontend (`boot.js`) re-calls `selectProject()` on change events. The green/red dot in the header reflects SSE connection state.

### Frontmatter

Memory files use YAML-style frontmatter delimited by `---`. Parsed by `parseFrontmatter()` in `lib/fileUtils.js`. Returns `{ name, description, type, body }`. The UI renders frontmatter as a separate card above the markdown preview (`buildFrontmatterBlock()` in `editor.js`).

---

## CSS Conventions

All CSS is in `public/styles.css`. It uses CSS custom properties for theming (dark by default, light via `@media (prefers-color-scheme: light)`). Key variables:

```css
--bg         background
--surface    card / panel background
--border     border color
--text        main text
--muted       secondary text
--accent      primary brand colour (buttons, active states)
--ok          green (SSE connected, health pass)
--warn        yellow (health warnings)
--err         red (health errors, SSE lost)
```

**Do not hardcode colours** — always use these variables so dark/light mode works.

Section comments in styles.css use `/* ── Section Name ── */` format. Keep that pattern when adding sections.

The layout is a CSS Grid with three resizable columns (sidebar / file list / editor). Column widths are persisted to localStorage by `resize.js` and restored via CSS variables on `<body>`.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | All projects with counts |
| GET | `/api/projects/:id/memories` | Memory files for project |
| PUT | `/api/file` | Save file `{ path, content }` |
| DELETE | `/api/file` | Delete file `{ path }` |
| POST | `/api/projects/:id/memories` | Create new memory file |
| GET | `/api/projects/:id/conversations` | Conversation metadata list |
| GET | `/api/conversation?path=` | Full conversation messages |
| GET | `/api/projects/:id/mdfiles` | MD files in project directory |
| GET | `/api/projects/:id/health` | Health check results |
| GET | `/api/projects/:id/claude-md` | CLAUDE.md content |
| GET | `/api/search?q=&type=` | Full-text search |
| GET | `/api/commands` | All custom Claude commands |
| POST | `/api/commands` | Create new command |
| GET | `/api/gitinfo?path=` | Last commit info for a file |
| GET | `/api/blame?path=` | Per-line blame data |
| GET | `/api/events` | SSE stream |

All responses are JSON. Errors return `{ error: "..." }` with appropriate HTTP status.

---

## Conventions & Rules

- **No build step.** Keep it that way unless there's a strong reason. CDN for marked.js is intentional.
- **No framework.** Vanilla JS only. DOM manipulation is direct, no virtual DOM.
- **CommonJS on the backend.** `require()` / `module.exports`. Not ESM.
- **Don't add error handling for internal flows.** Only validate at API boundaries (missing `path` param, etc.). Trust that internal functions get correct inputs.
- **CSS variables, not hardcoded values.** Always use `var(--name)`.
- **`saveUIState({ key })` for persistence, never full overwrite.** It merges via spread.
- **After any tab open/close/switch, call `saveTabState()`.** This is the only way tabs survive refresh.
- **`syncFileListActive()` after any tab activation.** Keeps the file list highlight in sync.
- **Blame button is hidden until git confirms the file is tracked.** The `gitinfo` fetch controls its visibility — don't change this.

---

## Common Extension Points

**Adding a new file type to the file list:** Create an adapter that calls `makeFileItem()` with the right descriptor. Add it to the appropriate section inside `renderFileList()`.

**Adding a new API endpoint:** Add the route handler in `server.js`. If the logic is more than ~20 lines, extract it to a new or existing `lib/` module.

**Adding a new persisted UI setting:** Add it to `state.js` as `let foo = _ui.foo ?? defaultValue`. Persist with `saveUIState({ foo })` wherever it changes. No other changes needed.

**Adding a new panel or column:** The layout uses CSS Grid on `.main-grid`. Column widths and resize handles are managed by `resize.js` — look at how existing handles work before adding new ones.
