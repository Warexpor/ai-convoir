import { useEffect, useRef } from "react";
import type { AppStatus, ConversationMode } from "../types";

interface KeyboardOptions {
  mode: ConversationMode | undefined;
  status: AppStatus;
  settingsOpen: boolean;
  helpOpen: boolean;
  railOpen: boolean;
  onToggleSettings: () => void;
  onToggleRail: () => void;
  onToggleHelp: () => void;
  onExport: () => void;
  onSaveChat: () => void;
  onStop: () => void;
  onStep: () => void;
  onToggleRun: () => void;
  onReset: () => void;
  onCloseHelp: () => void;
  onCloseSettings: () => void;
  onCloseRail: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function useAppKeyboard(opts: KeyboardOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const o = optsRef.current;
      const tag = (e.target as HTMLElement)?.tagName;
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.code === "KeyS" && !e.metaKey && !e.ctrlKey && !inField) {
        e.preventDefault();
        o.onToggleSettings();
      }
      if (e.code === "KeyB" && !e.metaKey && !e.ctrlKey && !inField) {
        e.preventDefault();
        o.onToggleRail();
      }
      if ((e.key === "?" || (e.shiftKey && e.code === "Slash")) && !inField) {
        e.preventDefault();
        o.onToggleHelp();
      }
      if (e.code === "KeyE" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        o.onExport();
      }
      if (e.code === "KeyS" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        o.onSaveChat();
      }
      if (e.code === "Escape") {
        if (o.status === "Running") o.onStop();
        else if (o.helpOpen) o.onCloseHelp();
        else if (o.settingsOpen) o.onCloseSettings();
        else if (o.railOpen) o.onCloseRail();
      }
      if (inField) return;
      if (o.helpOpen || o.settingsOpen) {
        if (e.code === "Space" || e.code === "KeyN") return;
      }
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        if (o.mode === "step") o.onStep();
        else o.onToggleRun();
      }
      if (e.code === "KeyN" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        o.onStep();
      }
      if (e.code === "KeyR" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        o.onReset();
      }
      if (e.ctrlKey && !e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          o.onZoomIn();
        } else if (e.key === "-" || e.code === "Minus") {
          e.preventDefault();
          o.onZoomOut();
        } else if (e.key === "0" || e.code === "Digit0") {
          e.preventDefault();
          o.onZoomReset();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
}
