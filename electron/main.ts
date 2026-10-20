import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Commands } from "./commands.js";
import * as db from "./db.js";
import { migrateLegacyLocalStorage, migrateLegacyDb } from "./migrate.js";
import { initLogging, logger } from "./logging.js";
import { cancelAllSignIns } from "./oauth.js";
import * as secrets from "./secrets.js";
import { AppState } from "./state.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const devUrl = process.env.VITE_DEV_SERVER_URL;

// Stable data dir regardless of productName spelling.
app.setPath("userData", path.join(app.getPath("appData"), "ai-convoir"));
app.setName("AI ConvoIR");

let win: BrowserWindow | null = null;
const state = new AppState();
const commands = new Commands(state, (event, payload) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("convoir:event", event, payload);
  }
});

function isHttp(url: string) {
  return /^https?:\/\//i.test(url);
}

function createWindow() {
  win = new BrowserWindow({
    title: "AI ConvoIR",
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111111" : "#e8e8e8",
    icon: path.join(root, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win?.show());

  // Links and popups go to the user's browser; the app never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const own = devUrl ? url.startsWith(devUrl) : url.startsWith("file://");
    if (!own) {
      e.preventDefault();
      if (isHttp(url)) void shell.openExternal(url);
    }
  });

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(root, "dist", "index.html"));
  win.on("closed", () => {
    win = null;
  });
}

ipcMain.handle("convoir:invoke", async (_e, cmd: unknown, args: unknown) => {
  try {
    if (typeof cmd !== "string") throw new Error("bad command");
    const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    let value: unknown;
    if (cmd === "open_external") {
      const url = String(a.url ?? "");
      if (!isHttp(url)) throw new Error("only http(s) links can be opened");
      await shell.openExternal(url);
      value = null;
    } else if (cmd === "legacy_local_storage") {
      value = migrateLegacyLocalStorage(app.getPath("userData"));
    } else {
      value = await commands.invoke(cmd, a);
    }
    return { ok: true, value: value ?? null };
  } catch (e) {
    const error = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    const data = app.getPath("userData");
    fs.mkdirSync(data, { recursive: true });
    logger.info("main", `logging to ${initLogging(data)}`);
    migrateLegacyDb(data);
    state.dbPath = path.join(data, "conversations.db");
    try {
      db.open(state.dbPath);
      logger.info("main", `db ready at ${state.dbPath}`);
    } catch (e) {
      logger.error("main", `db open failed: ${e}`);
    }
    secrets.initSecrets(data);
    try {
      await secrets.migrateLegacyKeychain();
    } catch (e) {
      logger.warn("secrets", `legacy keychain migration failed: ${e}`);
    }
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    state.bumpStreamEpoch();
    cancelAllSignIns();
    db.close();
  });
}
