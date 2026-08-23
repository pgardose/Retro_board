import React, { useState, useCallback } from "react";
import { Users, Link2, Plus, Wifi, WifiOff } from "lucide-react";
import { Canvas } from "./components/Canvas";
import { useMultiplayerRoom } from "./hooks/useMultiplayerRoom";

const App: React.FC = () => {
  const {
    notes,
    peers,
    localUser,
    updateCursor,
    addNote,
    updateNote,
    deleteNote,
    upvoteNote,
    boardSettings,
    toggleReveal,
    connected,
    roomId,
  } = useMultiplayerRoom();

  const localClientId = peers.find((p) => p.name === localUser.name)?.clientId;

  const [copyLabel, setCopyLabel] = useState("Copy link");

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy link"), 2000);
    });
  }, []);

  const handleAddNoteButton = useCallback(() => {
    addNote(1850 + Math.random() * 200, 1400 + Math.random() * 200);
  }, [addNote]);

  function bringToFront(id: string): void {
    throw new Error("Function not implemented.");
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 font-sans">
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm z-50 shrink-0">
        {/* Left: brand + room */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-slate-800 tracking-tight">Retro</span>
            <span className="text-lg font-bold text-indigo-600 tracking-tight">Board</span>
          </div>
          <span className="w-px h-5 bg-slate-200" />
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Wifi size={13} className="text-emerald-500" />
            ) : (
              <WifiOff size={13} className="text-slate-400 animate-pulse" />
            )}
            <span className="text-xs text-slate-500 font-mono">{roomId}</span>
          </div>
        </div>

        {/* Center: participant avatars */}
        <div className="flex items-center gap-2">
          <Users size={14} className="text-slate-400" />
          <div className="flex -space-x-2">
            {peers.slice(0, 8).map((peer) => (
              <div
                key={peer.clientId}
                title={peer.name}
                style={{ backgroundColor: peer.color }}
                className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] font-bold uppercase shadow-sm cursor-default"
              >
                {peer.name.charAt(0)}
              </div>
            ))}
            {peers.length > 8 && (
              <div className="w-7 h-7 rounded-full border-2 border-white bg-slate-300 flex items-center justify-center text-slate-600 text-[10px] font-bold shadow-sm">
                +{peers.length - 8}
              </div>
            )}
          </div>
          <span className="text-xs text-slate-400">{peers.length} online</span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 font-medium bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors"
          >
            <Link2 size={13} />
            {copyLabel}
          </button>
          <button
            onClick={handleAddNoteButton}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white font-semibold bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
          >
            <Plus size={13} />
            Add note
          </button>
        </div>
      </header>

      {/* ── Canvas workspace ─────────────────────────────────────────────── */}
      <Canvas
        notes={notes}
        peers={peers}
        localClientId={localClientId}
        localUserName={localUser.name}
        boardSettings={boardSettings}
        onUpdateCursor={updateCursor}
        onAddNote={addNote}
        onUpdateNote={updateNote}
        onDeleteNote={deleteNote}
        onUpvoteNote={upvoteNote}
        onBringToFront={bringToFront}
        onToggleReveal={toggleReveal}
        roomId={roomId}
        />

      {/* ── Bottom status bar ────────────────────────────────────────────── */}
            {/* ── Bottom status bar with Figma/Canva shortcuts ── */}
      <footer className="shrink-0 flex items-center justify-between px-4 py-2 bg-white border-t border-slate-200 text-xs text-slate-600 flex-wrap gap-2">
        {/* Left side: shortcuts */}
        <div className="flex items-center gap-3">
          <span className="font-medium text-slate-400">🖱️</span>
          
          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-[10px] font-mono">Space</kbd>
            <span className="mx-1">+</span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-[10px] font-mono">drag</kbd>
            <span className="mx-1.5 text-slate-400">·</span>
            <span>Pan</span>
          </span>

          <span className="w-px h-4 bg-slate-200" />

          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-[10px] font-mono">Ctrl</kbd>
            <span className="mx-1">+</span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-[10px] font-mono">scroll</kbd>
            <span className="mx-1.5 text-slate-400">·</span>
            <span>Zoom</span>
          </span>

          <span className="w-px h-4 bg-slate-200" />

          <span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-[10px] font-mono">⏎</kbd>
            <span className="mx-1.5 text-slate-400">·</span>
            <span>Double‑click to add</span>
          </span>
        </div>

        {/* Right side: sync info */}
        <span className="text-slate-400 flex items-center gap-1">
          <span>Synced via</span>
          <span className="font-mono text-slate-500">wss://demos.yjs.dev</span>
        </span>
      </footer>
    </div>
  );
};

export default App;