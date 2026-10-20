import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

ipcRenderer.on("convoir:event", (_e: IpcRendererEvent, name: string, payload: unknown) => {
  handlers.get(name)?.forEach((h) => h(payload));
});

contextBridge.exposeInMainWorld("convoir", {
  platform: process.platform,
  /** Rejects with the backend's plain error string (same contract as the old Tauri invoke). */
  async invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    const r = (await ipcRenderer.invoke("convoir:invoke", cmd, args ?? {})) as
      | { ok: true; value: unknown }
      | { ok: false; error: string };
    if (r.ok) return r.value;
    throw r.error;
  },
  on(name: string, handler: Handler): () => void {
    let set = handlers.get(name);
    if (!set) handlers.set(name, (set = new Set()));
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  },
});
