import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatView from "./components/ChatView";
import ControlBar from "./components/ControlBar";
import SettingsSidebar from "./components/SettingsSidebar";
import ChatRail from "./components/ChatRail";
import ShortcutsModal from "./components/ShortcutsModal";
import SettingsModal, { type SettingsTab } from "./components/SettingsModal";
import { useAppKeyboard } from "./hooks/useAppKeyboard";
import { useConversationApp } from "./hooks/useConversationApp";
import { useTokenUsage } from "./hooks/useTokenUsage";
import {
  PREF_KEYS,
  missingApiKeys,
  readBoolPref,
  readFx,
  readStreamMode,
  readZoom,
  writeBoolPref,
  writeFx,
  writeStreamMode,
  writeZoom,
  type FxLevel,
  type StreamMode,
} from "./lib/config";
import {
  IconMenu,
  IconRail,
  IconSliders,
  IconVoices,
  SlashMark,
} from "./components/Marks";
import PhoneOverflow from "./components/PhoneOverflow";
import { NARROW_QUERY, PHONE_QUERY, useMedia } from "./hooks/useMedia";
import { useBackClose } from "./hooks/useBackClose";
import { useEdgeSwipe } from "./hooks/useEdgeSwipe";
import StageField from "./components/StageField";
import StageImage from "./components/StageImage";
import {
  clearImage,
  loadImage,
  readBackground,
  saveImage,
  writeBackground,
  type BackgroundPrefs,
} from "./lib/background";
import CastStrip from "./components/CastStrip";
import { titleFromMessages } from "./lib/storage";
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
  const [voiceFocus, setVoiceFocus] = useState<string | null>(null);
  const editVoice = useCallback((id: string) => {
    setPrefsOpen(false);
    setVoiceFocus(id);
    setSettingsOpen(true);
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsTab, setPrefsTab] = useState<SettingsTab>("conversation");
  const [streamMode, setStreamMode] = useState<StreamMode>(readStreamMode);
  useEffect(() => writeStreamMode(streamMode), [streamMode]);
  const openPrefs = useCallback((tab?: SettingsTab) => {
    // The voices sheet keeps a draft; close it first so it commits.
    setSettingsOpen(false);
    if (tab) setPrefsTab(tab);
    setPrefsOpen(true);
  }, []);
  const [railOpen, setRailOpen] = useState(() =>
    readBoolPref(PREF_KEYS.railOpen, false),
  );
  const [showThoughtsUi, setShowThoughtsUi] = useState(() =>
    readBoolPref(PREF_KEYS.showThoughts, true),
  );
  const [zoom, setZoom] = useState(readZoom);
  const [fx, setFx] = useState<FxLevel>(readFx);
  useEffect(() => writeFx(fx), [fx]);
  const [bg, setBg] = useState<BackgroundPrefs>(readBackground);
  useEffect(() => writeBackground(bg), [bg]);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const showBlob = useCallback((b: Blob | null) => {
    setBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return b ? URL.createObjectURL(b) : null;
    });
  }, []);
  useEffect(() => {
    let live = true;
    void loadImage().then((b) => live && b && showBlob(b));
    return () => {
      live = false;
    };
  }, [showBlob]);
  const pickBgImage = useCallback(
    async (file: File) => {
      showBlob(await saveImage(file));
      setBg((v) => ({ ...v, kind: "image" }));
    },
    [showBlob],
  );
  const removeBgImage = useCallback(() => {
    void clearImage();
    showBlob(null);
    setBg((v) => ({ ...v, kind: "shader" }));
  }, [showBlob]);
  const [zoomMsg, setZoomMsg] = useState("");
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => writeBoolPref(PREF_KEYS.railOpen, railOpen), [railOpen]);
  useEffect(
    () => writeBoolPref(PREF_KEYS.showThoughts, showThoughtsUi),
    [showThoughtsUi],
  );
  useEffect(() => writeZoom(zoom), [zoom]);

  const isPhone = useMedia(PHONE_QUERY);
  const isNarrow = useMedia(NARROW_QUERY);
  useEffect(() => {
    if (window.matchMedia(NARROW_QUERY).matches) {
      setRailOpen(false);
    }
  }, []);
  // On narrow screens the rail is an overlay drawer: Back closes it and a
  // swipe from the left edge opens it, like any Android navigation drawer.
  useBackClose(isNarrow && railOpen, () => setRailOpen(false));
  useBackClose(helpOpen, () => setHelpOpen(false));
  useEdgeSwipe(isNarrow, railOpen, setRailOpen);

  const showZoomMsg = useCallback((val: number) => {
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
    setZoomMsg(`${Math.round(val * 100)}%`);
    zoomTimer.current = setTimeout(() => setZoomMsg(""), 1200);
  }, []);

  const handleStartFirst = useCallback(
    async (text: string) => {
      const result = await app.handleStartFirst(text);
      if (result?.needSettings) openPrefs("access");
    },
    [app.handleStartFirst, openPrefs],
  );

  useAppKeyboard({
    mode: config?.mode,
    status: stream.status,
    settingsOpen,
    helpOpen,
    prefsOpen,
    railOpen,
    onToggleSettings: () => {
      setPrefsOpen(false);
      setSettingsOpen((p) => !p);
    },
    onTogglePrefs: () => (prefsOpen ? setPrefsOpen(false) : openPrefs()),
    onClosePrefs: () => setPrefsOpen(false),
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
    upNextId && (hasMessages || stream.status === "Running")
      ? voiceIds.indexOf(upNextId)
      : -1;
  // Before the first autosave the thread has no saved title yet; name it
  // from its opening line the way the save will.
  const activeTitle = hasMessages
    ? chats.find((c) => c.id === activeChatId)?.title ||
      titleFromMessages(stream.messages, "")
    : "New thread";

  // Stable props for the memoized panels, so a streamed token re-renders
  // the transcript and not the closed sidebar, rail and modals behind it.
  const { handleReset, handleCreateCast, handleSelectChat, handleRenameCast } = app;
  const closeRail = useCallback(() => setRailOpen(false), []);
  const closePrefs = useCallback(() => setPrefsOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const closeVoices = useCallback(() => {
    setSettingsOpen(false);
    setVoiceFocus(null);
  }, []);
  const openAccess = useCallback(() => openPrefs("access"), [openPrefs]);
  const newThread = useCallback(
    (castId?: string) =>
      void handleReset(typeof castId === "string" ? castId : undefined),
    [handleReset],
  );
  const createCast = useCallback(
    (name: string) => {
      void handleCreateCast(name).then(() => setSettingsOpen(true));
    },
    [handleCreateCast],
  );
  const selectChat = useCallback(
    (id: string) => {
      handleSelectChat(id);
      if (isNarrow) setRailOpen(false);
    },
    [handleSelectChat, isNarrow],
  );
  const activeCastRef = useRef(activeCast);
  activeCastRef.current = activeCast;
  const renameActiveCast = useCallback(
    (name: string) => {
      const cast = activeCastRef.current;
      if (cast) handleRenameCast(cast.id, name);
    },
    [handleRenameCast],
  );
  const zoomTo = useCallback(
    (z: number) => {
      setZoom(z);
      showZoomMsg(z);
    },
    [showZoomMsg],
  );

  return (
    <div
      className={[
        "app",
        settingsOpen ? "settings-open" : "",
        railOpen ? "" : "rail-closed",
        railOpen ? "rail-open-mobile" : "",
        isPhone ? "is-phone" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-fx={fx}
      data-running={stream.status === "Running" ? "" : undefined}
      style={{ zoom }}
    >
      {bg.kind === "image" && bgUrl ? (
        <StageImage url={bgUrl} prefs={bg} />
      ) : (
        <StageField
          key={bg.preset}
          preset={bg.preset}
          colors={stageColors}
          focus={stageFocus}
          fx={fx}
        />
      )}
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
        onNew={newThread}
        onCreateCast={createCast}
        onRenameCast={app.handleRenameCast}
        onDeleteCast={app.handleDeleteCast}
        onSelect={selectChat}
        onDelete={app.handleDeleteChat}
        onClose={closeRail}
        onRename={refreshChats}
        needsKey={needsKey}
      />

      <div className="main" id="main" tabIndex={-1} role="main">
        <header className="topbar">
          <div className="topbar-lead">
            {isPhone ? (
              <button
                type="button"
                className="btn btn-icon btn-bare"
                onClick={() => setRailOpen(true)}
                aria-label="Show threads"
              >
                <IconMenu />
              </button>
            ) : (
              !railOpen && (
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => setRailOpen(true)}
                  title="Show sidebar (B)"
                  aria-label="Show sidebar"
                >
                  <IconRail />
                </button>
              )
            )}
            {!railOpen && !isPhone && (
              <SlashMark className="topbar-logo" size={20} />
            )}
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
            onEditVoice={editVoice}
          />

          {isPhone ? (
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-icon btn-bare"
              onClick={() => {
                setPrefsOpen(false);
                setSettingsOpen(true);
              }}
              aria-label="Voices"
            >
              <IconVoices />
            </button>
            <PhoneOverflow
              needsKey={needsKey}
              hasMessages={hasMessages}
              onSettings={() => openPrefs(needsKey ? "access" : undefined)}
              onNew={() => void app.handleReset()}
              onSave={app.handleSaveChat}
              onExport={app.handleExport}
            />
          </div>
          ) : (
          <div className="topbar-actions">
            <button
              type="button"
              className={`btn btn-icon${needsKey ? " needs-key" : ""}`}
              onClick={() => (prefsOpen ? setPrefsOpen(false) : openPrefs(needsKey ? "access" : undefined))}
              title="Settings (,)"
              aria-label="Settings"
              aria-pressed={prefsOpen}
            >
              <IconSliders />
            </button>
            <button
              type="button"
              className="btn btn-chrome"
              onClick={() => {
                setPrefsOpen(false);
                setSettingsOpen((p) => !p);
              }}
              title="Voices (S)"
              aria-pressed={settingsOpen}
            >
              <IconVoices />
              <span className="btn-label">Voices</span>
            </button>
          </div>
          )}
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
          streamMode={streamMode}
          firstDraft={firstDraft}
          onFirstDraftChange={setFirstDraft}
          onStartFirst={handleStartFirst}
          onDeleteMessage={app.handleDeleteMessage}
          hasSavedChats={chats.length > 0}
          needsKey={needsKey}
          onOpenSettings={openAccess}
          onEditVoice={editVoice}
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
            onReset={newThread}
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
            onOpenSettings={openAccess}
            compact={isPhone}
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
        onRenameCast={renameActiveCast}
        onClose={closeVoices}
        focusSlot={voiceFocus}
      />

      <SettingsModal
        open={prefsOpen}
        tab={prefsTab}
        onTab={setPrefsTab}
        onClose={closePrefs}
        config={config}
        onSaveConfig={app.handleSaveSettings}
        streamMode={streamMode}
        onStreamMode={setStreamMode}
        showThoughts={showThoughtsUi}
        onShowThoughts={setShowThoughtsUi}
        fx={fx}
        onFx={setFx}
        bg={bg}
        onBg={setBg}
        bgUrl={bgUrl}
        onPickBgImage={pickBgImage}
        onRemoveBgImage={removeBgImage}
        zoom={zoom}
        onZoom={zoomTo}
      />

      <ShortcutsModal open={helpOpen} onClose={closeHelp} />
    </div>
  );
}

export default App;
