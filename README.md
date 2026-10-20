# AI ConvoIR

**v2.0**: a desktop app where two or three AI voices take turns on one thread. Built on Electron, styled in the [GradatiON](https://github.com/Warexpor/GradatiON) design language (monochrome liquid glass).

![logo](public/logo.png)

## Features

- 2–3 voices with their own provider, model, prompt, tone and avatar; casts group voices and threads
- Providers: OpenCode Go/Zen, OpenAI, Anthropic, OpenRouter, xAI, Gemini, DeepSeek, Mistral, Ollama, any OpenAI-compatible endpoint, plus ChatGPT (Codex), Grok and OpenRouter sign-in
- SSE streaming (live, by paragraph or whole reply), reasoning folded into a Thinking row, Step / Auto runs, director whispers for the next speaker
- History panel grouped by date, markdown export, dark / light / system themes, four chat text sizes, shader or photo backgrounds

## Requirements

- [Node.js](https://nodejs.org/) 22.13+ (the Electron main process uses the built-in `node:sqlite`, no native modules)
- Python 3 with Pillow, only for `npm run icons`

## Run

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on :1420, compiles `electron/` with `tsc --watch` and opens Electron on the dev server. `npm run dev:web` serves only the UI in a browser (keys fall back to localStorage, no SQLite).

## Build

```bash
npm run dist            # installers for the current OS
npm run linux:build     # .deb + AppImage
npm run windows:build   # NSIS installer (run on Windows)
```

Output lands in `release/`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Electron app against the Vite dev server |
| `npm run dev:web` | UI only, in a browser |
| `npm run build` | Frontend (`dist/`) + main process (`dist-electron/`) |
| `npm start` | Run the built app with Electron |
| `npm run dist` | Build + electron-builder installers |
| `npm run typecheck` | TypeScript check, renderer and main |
| `npm run icons` | Regenerate icons (`scripts/make_icons.py`) |

## Data

- Chats: SQLite at `<appData>/ai-convoir/conversations.db` (`~/.config/ai-convoir` on Linux).
- Provider keys and sign-in tokens: encrypted with the OS keychain via Electron `safeStorage`. Where no keychain is available (Linux without a Secret Service), they fall back to localStorage.
- Log: `ai-convoir.log` next to the database; `CONVOIR_LOG=debug` for more.
- Coming from the Tauri build: on first launch the old database, localStorage (Linux) and keychain entries are copied over once. The old files are left in place.

## Architecture

| Area | Location |
|------|----------|
| Main process: window, IPC | `electron/main.ts`, `electron/preload.cts` |
| Conversation loop, commands | `electron/commands.ts`, `electron/engine.ts`, `electron/harness.ts` |
| Streaming, providers, OAuth | `electron/llm.ts`, `electron/oauth.ts` |
| SQLite, secrets, migration | `electron/db.ts`, `electron/secrets.ts`, `electron/migrate.ts` |
| UI shell | `src/App.tsx`, `src/components/` |
| IPC bridge, typed API | `src/lib/ipc.ts`, `src/lib/api.ts` |
| Design tokens and glass | `src/index.css` |

## Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Start / pause, or next turn in Step |
| `N` | Next voice speaks |
| `S` | Voices |
| `,` | Settings |
| `B` | History panel |
| `?` | Shortcuts |
| `Esc` | Stop run → close panels → hide history |
| `Ctrl+S` | Save chat |
| `Ctrl+E` | Export |
| `Ctrl+Shift+R` | New chat |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Enter` / `Shift+Enter` | Send / new line in the composer |

## Stack

Electron 44 · React 19 · TypeScript · Tailwind 4 · Vite · `node:sqlite`

## License

Private, see [LICENSE](LICENSE).
