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

## Project structure

```
claude-memory-gui/
├── server.js        # Express API — reads ~/.claude/, serves the app
├── public/
│   └── index.html   # Single-page UI (vanilla JS, no build step)
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
