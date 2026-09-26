import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatView from "./components/ChatView";
import ControlBar from "./components/ControlBar";
import SettingsSidebar from "./components/SettingsSidebar";
import ChatRail from "./components/ChatRail";
import ShortcutsModal from "./components/ShortcutsModal";
import { useAppKeyboard } from "./hooks/useAppKeyboard";
import { useConversationApp } from "./hooks/useConversationApp";
import { useTokenUsage } from "./hooks/useTokenUsage";
import {
  PREF_KEYS,
  missingApiKeys,
  readBoolPref,
  readFx,
  readZoom,
  writeBoolPref,
  writeFx,
  writeZoom,
  type FxLevel,
} from "./lib/config";
import { IconRail, IconVoices, SlashMark } from "./components/Marks";
import StageField from "./components/StageField";
import CastStrip from "./components/CastStrip";
import { activeAgentIds, agentAccent, agentLabel, nextAgentId } from "./types";

function App() {
  const app = useConversationApp();
  const {
    toast,
    stream,
    config,
    firstDraft,
    setFirstDraft,
    narration,
    setNarration,
    chats,
    activeChatId,
    refreshChats,
    casts,
    activeCastId,
  } = app;
  const activeCast = casts.find((c) => c.id === activeCastId) ?? null;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(() =>
    readBoolPref(PREF_KEYS.railOpen, false),
  );
  const [showThoughtsUi, setShowThoughtsUi] = useState(() =>
    readBoolPref(PREF_KEYS.showThoughts, true),
  );
  const [zoom, setZoom] = useState(readZoom);
  const [fx, setFx] = useState<FxLevel>(readFx);
  useEffect(() => writeFx(fx), [fx]);
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

  const upNextId = config ? nextAgentId(config, stream.turnCount) : null;
  const thinkingName = useMemo(
    () =>
      config && stream.status === "Running" && upNextId
        ? agentLabel(upNextId, config)
        : null,
    [config, stream.status, upNextId],
  );
  const { used: tokenUsed, capacity: tokenCapacity } = useTokenUsage(
    stream.messages,
    config,
  );

  const needsKey = !config || missingApiKeys(config);
  const nextName = config && upNextId ? agentLabel(upNextId, config) : null;
  const hasMessages = stream.messages.length > 0;
  const voiceIds = activeAgentIds(config);
  const stageColors = useMemo(
    () => voiceIds.map((id) => agentAccent(id, config)),
    [config],
  );
  const stageFocus =
    hasMessages && upNextId ? voiceIds.indexOf(upNextId) : -1;
  const activeTitle =
    (hasMessages && chats.find((c) => c.id === activeChatId)?.title) ||
    (hasMessages ? "Untitled thread" : "New thread");

  return (
    <div
      className={[
        "app",
        settingsOpen ? "settings-open" : "",
        railOpen ? "" : "rail-closed",
        railOpen ? "rail-open-mobile" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-fx={fx}
      data-running={stream.status === "Running" ? "" : undefined}
      style={{ zoom }}
    >
      <StageField colors={stageColors} focus={stageFocus} fx={fx} />
      <a className="skip-link" href="#main">
        Skip to transcript
      </a>

      <button
        type="button"
        className="rail-scrim"
        aria-label="Hide chats"
        aria-hidden={!railOpen}
        tabIndex={railOpen ? 0 : -1}
        onClick={() => setRailOpen(false)}
      />

      <ChatRail
        open={railOpen}
        chats={chats}
        activeId={activeChatId}
        casts={casts}
        activeCastId={activeCastId}
        onNew={(castId) => void app.handleReset(castId)}
        onCreateCast={(name) => {
          void app.handleCreateCast(name).then(() => setSettingsOpen(true));
        }}
        onRenameCast={app.handleRenameCast}
        onDeleteCast={app.handleDeleteCast}
        onSelect={(id) => {
          app.handleSelectChat(id);
          if (window.matchMedia("(max-width: 900px)").matches) {
            setRailOpen(false);
          }
        }}
        onDelete={app.handleDeleteChat}
        onClose={() => setRailOpen(false)}
        onRename={refreshChats}
        needsKey={needsKey}
      />

      <div className="main" id="main" tabIndex={-1} role="main">
        <header className="topbar">
          <div className="topbar-lead">
            {!railOpen && (
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setRailOpen(true)}
                title="Show sidebar (B)"
                aria-label="Show sidebar"
              >
                <IconRail />
              </button>
            )}
            {!railOpen && <SlashMark className="topbar-logo" size={20} />}
            <div className="topbar-title">
              <span className="topbar-name">{activeTitle}</span>
              <span className="topbar-sub">
                {activeCast && (
                  <span className="topbar-cast">{activeCast.name}</span>
                )}
                {hasMessages
                  ? `${stream.messages.length} lines · ${config?.mode === "auto" ? "Auto" : "Step"}`
                  : "Nothing said yet"}
              </span>
            </div>
          </div>

          <CastStrip
            config={config}
            status={stream.status}
            upNext={upNextId}
            hasMessages={hasMessages}
          />

          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-icon btn-kbd"
              onClick={() => setHelpOpen(true)}
              title="Shortcuts (?)"
              aria-label="Keyboard shortcuts"
            >
              ?
            </button>
            <button
              type="button"
              className={`btn btn-chrome${needsKey ? " needs-key" : ""}`}
              onClick={() => setSettingsOpen((p) => !p)}
              title="Voices & settings (S)"
              aria-pressed={settingsOpen}
            >
              <IconVoices />
              <span className="btn-label">Voices</span>
            </button>
          </div>
        </header>

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
          thinkingAgentId={upNextId}
          config={config}
          showThoughtsUi={showThoughtsUi}
          firstDraft={firstDraft}
          onFirstDraftChange={setFirstDraft}
          onStartFirst={handleStartFirst}
          onDeleteMessage={app.handleDeleteMessage}
          hasSavedChats={chats.length > 0}
          needsKey={needsKey}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {hasMessages && (
          <ControlBar
            status={stream.status}
            turnCount={stream.turnCount}
            maxTurns={config?.max_turns ?? 40}
            mode={config?.mode ?? "step"}
            onToggle={app.handleToggle}
            onStep={app.handleStep}
            onStop={app.handleStop}
            onReset={() => void app.handleReset()}
            onExport={app.handleExport}
            onModeChange={app.handleModeChange}
            onSaveChat={app.handleSaveChat}
            tokenUsed={tokenUsed}
            tokenCapacity={tokenCapacity}
            retryTarget={stream.lastFailed.current}
            onRetry={app.handleRetry}
            hasMessages
            nextName={nextName}
            nextAccent={upNextId ? agentAccent(upNextId, config) : undefined}
            needsKey={needsKey}
            onOpenSettings={() => setSettingsOpen(true)}
            hint={narration}
            onHintChange={setNarration}
            onHintCommit={app.handleNarrationCommit}
          />
        )}
      </div>

      <SettingsSidebar
        open={settingsOpen}
        config={config}
        onSave={app.handleSaveSettings}
        castName={activeCast?.name ?? null}
        onRenameCast={(name) =>
          activeCast && app.handleRenameCast(activeCast.id, name)
        }
        onClose={() => setSettingsOpen(false)}
        showThoughtsUi={showThoughtsUi}
        onShowThoughtsUiChange={setShowThoughtsUi}
        fx={fx}
        onFxChange={setFx}
      />

      <ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

export default App;
