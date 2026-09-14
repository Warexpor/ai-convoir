# AI Conversation

**v2.0** — Desktop multi-agent chat. Two or three voices take turns on one thread (OpenCode Go · Muse Spark 1.3 contributor).

![logo](public/logo.png)

## Features

- 2–3 voices, one shared OpenCode Go key
- Locked to Muse Spark 1.3 contributor
- SSE streaming, Step / Auto, Stop (keeps transcript), optional hint for the next speaker
- Saved chats, markdown export, keyboard shortcuts (`?`)

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- Tauri system deps for your OS ([guide](https://v2.tauri.app/start/prerequisites/))

On **Linux** you also need WebKitGTK 4.1 (Debian/Ubuntu):

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

## Install & run

```bash
npm install
npm run tauri dev
```

Production installers:

```bash
npm run release:build
```

Linux packages only (`.deb` + AppImage):

```bash
npm run linux:build
```

Outputs land under `src-tauri/target/release/bundle/` (NSIS / MSI on Windows; `deb/` and `appimage/` on Linux).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run tauri dev` | Desktop app in development |
| `npm run build` | Frontend production build |
| `npm run release:build` | Frontend + Tauri release bundles |
| `npm run linux:build` | Linux `.deb` + AppImage |
| `npm run typecheck` | TypeScript check |
| `npm run test:rust` | Rust unit tests |
| `npm run icons` | Regenerate icons (`scripts/make_icons.py`) |

## Configuration

API keys are entered in **Settings** inside the app (not required in `.env`).  
See [`.env.example`](.env.example) only if you later wire env-based keys.

Chats persist in a local SQLite database (app data dir). Browser Vite preview can use a localStorage cache.

## Architecture

| Area | Location |
|------|----------|
| UI shell | `src/App.tsx` |
| Conversation / stream hooks | `src/hooks/` |
| Typed Tauri API | `src/lib/api.ts` |
| Config + prefs | `src/lib/config.ts` |
| Chat / API profile storage | `src/lib/storage.ts` |
| Rust engine + SQLite | `src-tauri/src/` |

## Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Start/pause or step |
| `N` | Step one turn |
| `S` | Settings |
| `B` | Chats sidebar |
| `?` | Shortcuts |
| `Esc` | Stop → close overlays |
| `Ctrl+S` | Save chat |
| `Ctrl+E` | Export |
| `Ctrl+Shift+R` | New chat |

## Stack

Tauri 2 · React 18 · TypeScript · Tailwind · Rust (`reqwest` SSE, `rusqlite`)

## License

Private — see [LICENSE](LICENSE).
