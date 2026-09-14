import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatView from "./components/ChatView";
import ControlBar from "./components/ControlBar";
import SettingsSidebar from "./components/SettingsSidebar";
import NarrateBar from "./components/NarrateBar";
import ChatRail from "./components/ChatRail";
import ShortcutsModal from "./components/ShortcutsModal";
import { useAppKeyboard } from "./hooks/useAppKeyboard";
import { useConversationApp } from "./hooks/useConversationApp";
import { useTokenUsage } from "./hooks/useTokenUsage";
import {
  PREF_KEYS,
  missingApiKeys,
  readBoolPref,
  readZoom,
  writeBoolPref,
  writeZoom,
} from "./lib/config";
import { agentLabel, nextAgentId } from "./types";

function App() {
  const app = useConversationApp();
  const {
    toast,
    stream,
    config,
    pushConfig,
    firstDraft,
    setFirstDraft,
    narration,
    setNarration,
    chats,
    activeChatId,
    refreshChats,
  } = app;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(() =>
    readBoolPref(PREF_KEYS.railOpen, true),
  );
  const [showThoughtsUi, setShowThoughtsUi] = useState(() =>
    readBoolPref(PREF_KEYS.showThoughts, true),
  );
  const [zoom, setZoom] = useState(readZoom);
  const [zoomMsg, setZoomMsg] = useState("");
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => writeBoolPref(PREF_KEYS.railOpen, railOpen), [railOpen]);
  useEffect(
    () => writeBoolPref(PREF_KEYS.showThoughts, showThoughtsUi),
    [showThoughtsUi],
  );
  useEffect(() => writeZoom(zoom), [zoom]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setRailOpen(false);
    }
  }, []);

  const showZoomMsg = useCallback((val: number) => {
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
    setZoomMsg(`${Math.round(val * 100)}%`);
    zoomTimer.current = setTimeout(() => setZoomMsg(""), 1200);
  }, []);

  const handleStartFirst = useCallback(
    async (text: string) => {
      const result = await app.handleStartFirst(text);
      if (result?.needSettings) setSettingsOpen(true);
    },
    [app.handleStartFirst],
  );

  useAppKeyboard({
    mode: config?.mode,
    status: stream.status,
    settingsOpen,
    helpOpen,
    railOpen,
    onToggleSettings: () => setSettingsOpen((p) => !p),
    onToggleRail: () => setRailOpen((p) => !p),
    onToggleHelp: () => setHelpOpen((p) => !p),
    onExport: app.handleExport,
    onSaveChat: app.handleSaveChat,
    onStop: app.handleStop,
    onStep: app.handleStep,
    onToggleRun: app.handleToggle,
    onReset: app.handleReset,
    onCloseHelp: () => setHelpOpen(false),
    onCloseSettings: () => setSettingsOpen(false),
    onCloseRail: () => setRailOpen(false),
    onZoomIn: () =>
      setZoom((z) => {
        const next = Math.min(2, Math.round((z + 0.1) * 10) / 10);
        showZoomMsg(next);
        return next;
      }),
    onZoomOut: () =>
      setZoom((z) => {
        const next = Math.max(0.5, Math.round((z - 0.1) * 10) / 10);
        showZoomMsg(next);
        return next;
      }),
    onZoomReset: () => {
      setZoom(1);
      showZoomMsg(1);
    },
  });

  const thinkingName = useMemo(
    () =>
      config && stream.status === "Running"
        ? agentLabel(nextAgentId(config, stream.turnCount), config)
        : null,
    [config, stream.status, stream.turnCount],
  );
  const { used: tokenUsed, capacity: tokenCapacity } = useTokenUsage(
    stream.messages,
    config,
  );

  const needsKey = !config || missingApiKeys(config);
  const agentNames = useMemo(() => {
    if (!config) return ["Ava", "Jules"];
    if (config.bot_count >= 3) {
      return [
        config.ai1_config.name,
        config.ai2_config.name,
        config.ai3_config.name,
      ];
    }
    return [config.ai1_config.name, config.ai2_config.name];
  }, [config]);
  const nextName = config
    ? agentLabel(nextAgentId(config, stream.turnCount), config)
    : null;

  return (
    <div
      className={[
        "app",
        settingsOpen && config ? "settings-open" : "",
        railOpen ? "" : "rail-closed",
        railOpen ? "rail-open-mobile" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ zoom }}
    >
      <a className="skip-link" href="#main">
        Skip to transcript
      </a>

      {railOpen && (
        <button
          type="button"
          className="rail-scrim"
          aria-label="Hide chats"
          onClick={() => setRailOpen(false)}
        />
      )}

      {railOpen && (
        <ChatRail
          chats={chats}
          activeId={activeChatId}
          onNew={app.handleReset}
          onSelect={(id) => {
            app.handleSelectChat(id);
            if (window.matchMedia("(max-width: 900px)").matches) {
              setRailOpen(false);
            }
          }}
          onDelete={app.handleDeleteChat}
          onClose={() => setRailOpen(false)}
          onRename={refreshChats}
        />
      )}

      <header className="topbar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/logo.svg"
            width={18}
            height={18}
            alt=""
          />
          <div className="brand-text">
            <p className="brand-mark">AI Conversation</p>
            <span className="topbar-sub">
              {config
                ? agentNames.filter(Boolean).join(" · ")
                : "loading"}
            </span>
          </div>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setRailOpen((p) => !p)}
          title="Toggle chats (B)"
          aria-pressed={railOpen}
        >
          Chats
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setSettingsOpen((p) => !p)}
          title="Toggle settings (S)"
          aria-pressed={settingsOpen}
        >
          Settings
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => setHelpOpen(true)}
          title="Shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      </header>

      <div className="main" id="main" tabIndex={-1} role="main">

        {toast.message !== null && (
          <div
            className={`toast ${toast.leaving ? "leaving" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span className="toast-text">{toast.message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={toast.clear}
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        )}

        {zoomMsg && (
          <div className="zoom-badge" role="status" aria-live="polite">
            {zoomMsg}
          </div>
        )}

        <ChatView
          messages={stream.messages}
          isThinking={
            stream.isThinking && !stream.messages.some((m) => m.streaming)
          }
          thinkingAgent={thinkingName}
          config={config}
          showThoughtsUi={showThoughtsUi}
          firstDraft={firstDraft}
          onFirstDraftChange={setFirstDraft}
          onStartFirst={handleStartFirst}
          onDeleteMessage={app.handleDeleteMessage}
          hasSavedChats={chats.length > 0}
          needsKey={needsKey}
          onOpenSettings={() => setSettingsOpen(true)}
          agentNames={agentNames}
        />

        {stream.messages.length > 0 && (
          <NarrateBar
            config={config}
            turnCount={stream.turnCount}
            value={narration}
            onChange={setNarration}
            onCommit={app.handleNarrationCommit}
            disabled={stream.status === "Running"}
          />
        )}

        {stream.messages.length > 0 && (
          <ControlBar
            status={stream.status}
            turnCount={stream.turnCount}
            maxTurns={config?.max_turns ?? 40}
            mode={config?.mode ?? "step"}
            onToggle={app.handleToggle}
            onStep={app.handleStep}
            onStop={app.handleStop}
            onReset={app.handleReset}
            onExport={app.handleExport}
            onModeChange={app.handleModeChange}
            onSaveChat={app.handleSaveChat}
            tokenUsed={tokenUsed}
            tokenCapacity={tokenCapacity}
            retryTarget={stream.lastFailed.current}
            onRetry={app.handleRetry}
            hasMessages
            nextName={nextName}
            needsKey={needsKey}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </div>

      {config && (
        <SettingsSidebar
          open={settingsOpen}
          config={config}
          onSave={pushConfig}
          onClose={() => setSettingsOpen(false)}
          showThoughtsUi={showThoughtsUi}
          onShowThoughtsUiChange={setShowThoughtsUi}
        />
      )}

      <ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

export default App;
