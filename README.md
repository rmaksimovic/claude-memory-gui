# Claude Memory GUI

A local web UI for browsing and managing your [Claude Code](https://claude.ai/code) memory files, conversations, and project context — all in one place.

![Claude Memory GUI](https://img.shields.io/badge/Claude-Memory%20GUI-orange?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)

## Features

- **Memory browser** — view, edit, and create memory files across global and per-project scopes
- **Conversation viewer** — browse all Claude Code chat histories with full message rendering (code blocks, markdown)
- **Cost & token stats** — per-conversation token breakdown (input, output, cache write 5m/1h, cache read) with estimated USD cost and cache savings
- **MD file scanner** — recursively finds all `.md` files inside your project directories
- **Health checks** — detects broken MEMORY.md pointers, stale project dates, duplicate names, and index overflow
- **Live updates** — file watcher broadcasts changes via SSE so the UI refreshes without a reload
- **Resizable panels** — sidebar, file list, editor, and stats panel are all drag-resizable

## Requirements

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) installed and used at least once (so `~/.claude/` exists)

## Running locally

```bash
git clone https://github.com/rmaksimovic/claude-memory-gui.git
cd claude-memory-gui
npm install
npm start
```

Then open [http://localhost:3737](http://localhost:3737) in your browser.

The server reads directly from `~/.claude/` — no configuration needed.

## Running as a Claude Code slash command

A great way to launch the GUI on demand is to register it as a custom Claude Code command so you can start it from any project with `/memory-gui`.

Create `~/.claude/commands/memory-gui.md`:

```markdown
Start the Claude Memory GUI server if it's not already running, then open it in the browser.

Run this shell command:
\```bash
cd ~/path/to/claude-memory-gui && npm start &
open http://localhost:3737
\```
```

Then from any Claude Code session, type `/memory-gui` and Claude will start the server and open the UI.

Alternatively, add it to your shell profile so it's always available:

```bash
# ~/.zshrc or ~/.bashrc
alias memory-gui='cd ~/path/to/claude-memory-gui && npm start & sleep 1 && open http://localhost:3737'
```

## Recommended: track your memory files with git

Your Claude memory files live in `~/.claude/` and can quietly drift — memories get added, updated, or removed across dozens of sessions with no history. Putting that folder under git gives you a full audit trail of what Claude remembers about your projects.

```bash
cd ~/.claude
git init
```

Then create `~/.claude/.gitignore` to track only the meaningful files and ignore ephemeral data:

```gitignore
# Ignore everything by default
*

# Track memory files across all projects
!projects/
!projects/*/
!projects/*/memory/
!projects/*/memory/**
!projects/*/CLAUDE.md

# Track global memory
!memory/
!memory/**

# Track custom commands
!commands/
!commands/**

# Track settings (not local overrides)
!settings.json
```

Make an initial commit:

```bash
git add -A
git commit -m "Initial memory snapshot"
```

You can also push to a private remote repository to back up your memory across machines.

### Automatic git tracking

Once `~/.claude` is a git repository, the Memory GUI takes care of committing for you:

- **New memory or command file** — automatically staged and committed the moment it's created (`Add memory: filename.md`)
- **File save** — automatically committed every time you save a file through the editor (`Update: filename.md`)

This means the **blame gutter** in the file editor always reflects real edit history — each block shows when it was last changed, not just when the file was first created. No manual committing needed.

> If `~/.claude` is not a git repo, auto-tracking is silently skipped and everything still works normally.

## Project structure

```
claude-memory-gui/
├── server.js          # Thin Express entry point
├── lib/               # Backend modules
│   ├── config.js      # Pricing table, constants
│   ├── paths.js       # Path resolution helpers
│   ├── fileUtils.js   # File I/O, frontmatter parsing
│   ├── projects.js    # Project listing, memory index
│   ├── health.js      # Health checks, MEMORY.md sync
│   ├── conversations.js
│   ├── commands.js
│   ├── git.js         # git blame / git log integration
│   └── sse.js         # Live file-watching via SSE
├── public/
│   ├── index.html     # Markup only
│   ├── styles.css
│   └── js/            # Frontend modules (vanilla JS)
│       ├── api.js · state.js · tabs.js · projects.js
│       ├── files.js · editor.js · commands.js
│       ├── conversations.js · modals.js · boot.js
│       └── utils.js · resize.js · stats.js
└── package.json
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects with memory/conversation/md counts |
| GET | `/api/projects/:id/memories` | Memory files for a project |
| GET | `/api/projects/:id/conversations` | Conversation list |
| GET | `/api/projects/:id/mdfiles` | All `.md` files in the real project directory |
| GET | `/api/projects/:id/health` | Health check results |
| GET | `/api/conversation?path=` | Full conversation messages |
| GET | `/api/file?path=` | Read any file by absolute path |
| PUT | `/api/file` | Save a file |
| GET | `/api/search?q=` | Full-text search across all memory files |
| GET | `/api/events` | SSE stream for live file-change events |

## License

MIT
