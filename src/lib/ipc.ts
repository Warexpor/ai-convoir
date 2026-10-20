/** Bridge exposed by electron/preload.cts. Absent in the plain Vite browser preview. */
interface ConvoirBridge {
  platform: string;
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    convoir?: ConvoirBridge;
  }
}

/** True inside the Electron app (vs the Vite browser preview). */
export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && !!window.convoir;
}

/** Call a main-process command. Rejects with the backend's error string. */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.convoir) return Promise.reject("desktop backend unavailable");
  return window.convoir.invoke(cmd, args) as Promise<T>;
}

/** Subscribe to a main-process event; returns the unsubscribe function. */
export function listen<T>(event: string, handler: (payload: T) => void): () => void {
  if (!window.convoir) return () => {};
  return window.convoir.on(event, (p) => handler(p as T));
}
