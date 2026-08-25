import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  useLayoutEffect,
} from "react";
import { Eye, EyeOff, Download, Plus } from "lucide-react";
import { toPng } from "html-to-image";
import { StickyNote } from "./StickyNote";
import type {
  NoteData,
  NoteCategory,
  AwarenessUser,
  BoardSettings,
} from "../hooks/useMultiplayerRoom";

// ─── Shared note width constant ───────────────────────────────────────────────
// 240px: slightly wider than before for better readability at typical zoom levels.
export const NOTE_WIDTH = 240;

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColumnDef {
  key: NoteCategory;
  label: string;
  emoji: string;
  widthFraction: number;
  laneBg: string;
  headerBg: string;
  accentColor: string;
  dividerColor: string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: "went-well",
    label: "Went Well",
    emoji: "✅",
    widthFraction: 1 / 3,
    laneBg: "linear-gradient(180deg, #F1FAF4 0%, #EDE9E3 100%)",
    headerBg: "#D5EDDA",
    accentColor: "#2E7D52",
    dividerColor: "#B4D9BE",
  },
  {
    key: "needs-improvement",
    label: "Needs Improvement",
    emoji: "🔧",
    widthFraction: 1 / 3,
    laneBg: "linear-gradient(180deg, #FFFCF0 0%, #EDE9E3 100%)",
    headerBg: "#FDE9B0",
    accentColor: "#92600A",
    dividerColor: "#F5D57A",
  },
  {
    key: "action-items",
    label: "Action Items",
    emoji: "🚀",
    widthFraction: 1 / 3,
    laneBg: "linear-gradient(180deg, #F0F5FF 0%, #EDE9E3 100%)",
    headerBg: "#DBEAFE",
    accentColor: "#1E4FBF",
    dividerColor: "#BFCFEF",
  },
];

export const CANVAS_WIDTH = 4000;
export const CANVAS_HEIGHT = 3000;

const MIN_SCALE = 0.15;
const MAX_SCALE = 3.0;
const WHEEL_SENSITIVITY = 0.001;

// Warm linen — the signature canvas background
const CANVAS_BG = "#EDE9E3";

export function categoryFromX(x: number): NoteCategory {
  let accumulated = 0;
  for (const col of COLUMNS) {
    accumulated += col.widthFraction * CANVAS_WIDTH;
    if (x < accumulated) return col.key;
  }
  return COLUMNS[COLUMNS.length - 1].key;
}

// ─── Transform ────────────────────────────────────────────────────────────────

interface Transform {
  x: number;
  y: number;
  scale: number;
}

// ─── Remote cursor ────────────────────────────────────────────────────────────

const RemoteCursor: React.FC<{ peer: AwarenessUser }> = ({ peer }) => {
  if (!peer.cursor) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: peer.cursor.x,
        top: peer.cursor.y,
        pointerEvents: "none",
        zIndex: 9999,
        transition: "left 60ms linear, top 60ms linear",
        willChange: "left, top",
      }}
    >
      <svg
        width="20" height="20" viewBox="0 0 20 20" fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))" }}
      >
        <path
          d="M3 2L16 10L9.5 11.5L6.5 18L3 2Z"
          fill={peer.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round"
        />
      </svg>
      <span
        style={{ backgroundColor: peer.color }}
        className="absolute left-4 top-3 whitespace-nowrap text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full shadow-md"
      >
        {peer.name}
      </span>
    </div>
  );
};

// ─── Column layer ─────────────────────────────────────────────────────────────
//
// Signature design element: tall poster-style headers, each with a large emoji,
// bold sentence-case label in the column's accent colour, a 4px solid accent
// bottom-border, and a gradient lane that fades into the shared linen canvas.
// Column separators use inset box-shadow for a softer, tapered divider.

const ColumnLayer: React.FC<{ noteCounts: Record<NoteCategory, number> }> = ({
  noteCounts,
}) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", pointerEvents: "none" }}>
    {COLUMNS.map((col, i) => (
      <div
        key={col.key}
        style={{
          width: `${col.widthFraction * 100}%`,
          flexShrink: 0,
          background: col.laneBg,
          boxShadow:
            i < COLUMNS.length - 1
              ? `inset -1px 0 0 0 ${col.dividerColor}, inset -4px 0 12px -4px rgba(0,0,0,0.04)`
              : "none",
          position: "relative",
        }}
      >
        {/* ── Poster header ── */}
        <div
          style={{ background: col.headerBg, borderBottom: `4px solid ${col.accentColor}` }}
          className="flex items-center gap-3 px-6 py-4"
        >
          <span
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))" }}
            className="text-2xl leading-none select-none"
            aria-hidden="true"
          >
            {col.emoji}
          </span>
          <span
            style={{ color: col.accentColor }}
            className="font-extrabold text-[15px] tracking-tight leading-none"
          >
            {col.label}
          </span>
          {noteCounts[col.key] > 0 && (
            <span
              style={{ backgroundColor: col.accentColor, color: "#fff" }}
              className="ml-auto tabular text-[11px] font-bold px-2 py-0.5 rounded-full leading-none"
              title={`${noteCounts[col.key]} note${noteCounts[col.key] !== 1 ? "s" : ""}`}
            >
              {noteCounts[col.key]}
            </span>
          )}
        </div>
      </div>
    ))}
  </div>
);

// ─── Canvas props ─────────────────────────────────────────────────────────────

interface CanvasProps {
  notes: NoteData[];
  peers: AwarenessUser[];
  localClientId?: number;
  localUserName: string;
  boardSettings: BoardSettings;
  onUpdateCursor: (x: number, y: number) => void;
  onAddNote: (x: number, y: number) => string;
  onUpdateNote: (id: string, patch: Partial<Omit<NoteData, "id">>) => void;
  onDeleteNote: (id: string) => void;
  onUpvoteNote: (id: string) => void;
  onBringToFront: (id: string) => void;
  onToggleReveal: () => void;
  roomId: string;
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

export const Canvas: React.FC<CanvasProps> = ({
  notes,
  peers,
  localClientId,
  localUserName,
  boardSettings,
  onUpdateCursor,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onUpvoteNote,
  onBringToFront,
  onToggleReveal,
  roomId,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLDivElement>(null);

  // ── Transform ─────────────────────────────────────────────────────────────
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const [scale, setScale] = useState(1);

  const applyTransform = useCallback((t: Transform) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    canvas.style.transformOrigin = "0 0";
    transformRef.current = t;
  }, []);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const initialX = Math.max(0, (vp.clientWidth - CANVAS_WIDTH) / 2);
    applyTransform({ x: initialX, y: 24, scale: 1 });
    setScale(1);
  }, [applyTransform]);

  // ── Spacebar gate ─────────────────────────────────────────────────────────
  const spacePressed = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "textarea" || tag === "input") return;
      e.preventDefault();
      if (!spacePressed.current) { spacePressed.current = true; setSpaceDown(true); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spacePressed.current = false;
      setSpaceDown(false);
      panAnchor.current = null;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
    };
  }, []);

  // ── Pan ───────────────────────────────────────────────────────────────────
  const panAnchor = useRef<{ pointerX: number; pointerY: number; tx: number; ty: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const handleViewportPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if ((e.target as HTMLElement).closest("[data-note-root]")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = transformRef.current;
    panAnchor.current = { pointerX: e.clientX, pointerY: e.clientY, tx: t.x, ty: t.y };
    setIsPanning(true);
  }, []);

  const handleViewportPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const t = transformRef.current;
    onUpdateCursor((e.clientX - t.x) / t.scale, (e.clientY - t.y) / t.scale);
    if (!panAnchor.current) return;
    applyTransform({
      ...t,
      x: panAnchor.current.tx + (e.clientX - panAnchor.current.pointerX),
      y: panAnchor.current.ty + (e.clientY - panAnchor.current.pointerY),
    });
  }, [onUpdateCursor, applyTransform]);

  const handleViewportPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (panAnchor.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      panAnchor.current = null;
      setIsPanning(false);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => { e.preventDefault(); }, []);

  // ── Wheel: zoom (Ctrl/Meta) or pan (plain) ────────────────────────────────
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rawDelta  = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;
        const newScale  = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * (1 - rawDelta * WHEEL_SENSITIVITY)));
        if (newScale === t.scale) return;
        const rect = vp.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        applyTransform({
          x: px - (px - t.x) * (newScale / t.scale),
          y: py - (py - t.y) * (newScale / t.scale),
          scale: newScale,
        });
        setScale(newScale);
        return;
      }
      applyTransform({
        ...t,
        x: t.x - (e.deltaMode === 0 ? e.deltaX : e.deltaX * 20),
        y: t.y - (e.deltaMode === 0 ? e.deltaY : e.deltaY * 20),
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [applyTransform]);

  // ── Note creation ─────────────────────────────────────────────────────────
  const [latestNoteId, setLatestNoteId] = useState<string | null>(null);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-note-root]")) return;
    const t = transformRef.current;
    const id = onAddNote(
      Math.max(0, (e.clientX - t.x) / t.scale - NOTE_WIDTH / 2),
      Math.max(0, (e.clientY - t.y) / t.scale - 60),
    );
    setLatestNoteId(id);
  }, [onAddNote]);

  const handleAddNoteFromDock = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const t = transformRef.current;
    const id = onAddNote(
      Math.max(0, (vp.clientWidth  / 2 - t.x) / t.scale - NOTE_WIDTH / 2),
      Math.max(0, (vp.clientHeight / 2 - t.y) / t.scale - 60),
    );
    setLatestNoteId(id);
  }, [onAddNote]);

  const handleNoteDragEnd = useCallback((id: string, finalX: number) => {
    onUpdateNote(id, { category: categoryFromX(finalX) });
  }, [onUpdateNote]);

  // ── Export ────────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    const node = canvasRef.current;
    if (!node) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(node, {
        cacheBust: true, pixelRatio: 2, backgroundColor: CANVAS_BG,
        width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
        style: { transform: "none", transformOrigin: "0 0" },
      });
      const a = document.createElement("a");
      a.download = `retro-board-${roomId}-${Date.now()}.png`;
      a.href = dataUrl;
      a.click();
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setIsExporting(false);
    }
  }, [roomId]);

  // ── Note counts for column badges ─────────────────────────────────────────
  const noteCounts = React.useMemo<Record<NoteCategory, number>>(() => {
    const counts: Record<NoteCategory, number> = {
      "went-well": 0, "needs-improvement": 0, "action-items": 0,
    };
    for (const note of notes) {
      const cat = note.category ?? categoryFromX(note.x);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [notes]);

  const remotePeers  = peers.filter((p) => p.clientId !== localClientId);
  const cursorStyle  = isPanning ? "grabbing" : spaceDown ? "grab" : "crosshair";
  const zoomPercent  = Math.round(scale * 100);

  return (
    <>
      {/* ── Viewport ──────────────────────────────────────────────────────── */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden"
        style={{
          cursor: cursorStyle,
          backgroundImage: "radial-gradient(circle, #C4BDB5 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          backgroundColor: CANVAS_BG,
        }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {/* ── Canvas 4000×3000 ──────────────────────────────────────────── */}
        <div
          ref={canvasRef}
          style={{
            position: "absolute", top: 0, left: 0,
            width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
            backgroundColor: CANVAS_BG,
          }}
        >
          <ColumnLayer noteCounts={noteCounts} />

          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              canvasRef={canvasRef}
              localUserName={localUserName}
              isRevealed={boardSettings.isRevealed}
              scale={scale}
              onUpdate={onUpdateNote}
              onDelete={onDeleteNote}
              onUpvote={onUpvoteNote}
              onBringToFront={onBringToFront}
              onDragEnd={handleNoteDragEnd}
              focusOnMount={note.id === latestNoteId}
            />
          ))}

          {remotePeers.map((peer) => (
            <RemoteCursor key={peer.clientId} peer={peer} />
          ))}
        </div>

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {notes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="text-center rounded-2xl px-10 py-7 border"
              style={{
                background: "rgba(255,253,248,0.82)",
                backdropFilter: "blur(8px)",
                borderColor: "rgba(180,160,130,0.25)",
                boxShadow: "0 2px 16px 0 rgba(60,45,20,0.07)",
              }}
            >
              <p className="text-3xl mb-3 select-none" aria-hidden="true">✦</p>
              <p className="font-semibold text-[15px] text-stone-700 mb-1">
                Double-click anywhere to add a note
              </p>
              <p className="text-[12px] text-stone-400 leading-relaxed">
                Drop notes into columns · Space or MMB + drag to pan
                <br />
                Two-finger scroll · Pinch or Ctrl+scroll to zoom
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Zoom chip — fixed top-right, immune to canvas transform ──────── */}
      <div className="fixed top-[60px] right-4 z-[90] pointer-events-none">
        <div
          className="tabular text-[11px] font-semibold px-2.5 py-1 rounded-lg select-none"
          style={{
            background: "rgba(255,253,248,0.88)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(180,160,130,0.30)",
            boxShadow: "0 1px 4px rgba(60,45,20,0.08)",
            color: "#57534e",
          }}
          aria-label={`Zoom level: ${zoomPercent}%`}
        >
          {zoomPercent}%
        </div>
      </div>

      {/* ── Floating action dock ──────────────────────────────────────────── */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]
                   flex items-center gap-1.5 px-2.5 py-2"
        style={{
          background: "rgba(255,253,248,0.90)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(180,160,130,0.28)",
          borderRadius: "16px",
          boxShadow: "0 8px 32px 0 rgba(30,20,10,0.10), 0 1px 4px 0 rgba(30,20,10,0.06)",
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {/* Primary: Add note */}
        <DockButton
          onClick={handleAddNoteFromDock}
          icon={<Plus size={14} strokeWidth={2.5} />}
          label="Add note"
          variant="primary"
        />

        <DockDivider />

        {/* Secondary: Reveal / Hide */}
        <DockButton
          onClick={onToggleReveal}
          icon={boardSettings.isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
          label={boardSettings.isRevealed ? "Hide" : "Reveal"}
          variant={boardSettings.isRevealed ? "active" : "default"}
        />

        {/* Tertiary: Export */}
        <DockButton
          onClick={handleExport}
          disabled={isExporting}
          icon={<Download size={14} />}
          label={isExporting ? "Exporting…" : "Export"}
          variant="ghost"
        />
      </div>
    </>
  );
};

// ─── Dock primitives ──────────────────────────────────────────────────────────

const DockDivider: React.FC = () => (
  <div
    className="w-px h-4 mx-1 shrink-0"
    style={{ background: "rgba(180,160,130,0.35)" }}
    aria-hidden="true"
  />
);

interface DockButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  variant?: "default" | "primary" | "active" | "ghost";
  disabled?: boolean;
}

const DockButton: React.FC<DockButtonProps> = ({
  onClick, icon, label, variant = "default", disabled = false,
}) => {
  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl " +
    "text-[12px] font-semibold leading-none select-none whitespace-nowrap " +
    "transition-all duration-100 active:scale-[0.94] ";

  const styles: Record<string, React.CSSProperties> = {
    default: {
      background: "rgba(237,233,227,0.80)",
      color: "#44403c",
      border: "1px solid rgba(180,160,130,0.30)",
    },
    primary: {
      background: "#4F46E5",
      color: "#ffffff",
      border: "1px solid #4338CA",
      boxShadow: "0 1px 4px rgba(79,70,229,0.30)",
    },
    active: {
      background: "#7C3AED",
      color: "#ffffff",
      border: "1px solid #6D28D9",
      boxShadow: "0 1px 4px rgba(124,58,237,0.30)",
    },
    ghost: {
      background: "transparent",
      color: "#78716c",
      border: "1px solid transparent",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${disabled ? "opacity-50 cursor-wait" : "hover:brightness-95"}`}
      style={styles[variant]}
      aria-label={label}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};