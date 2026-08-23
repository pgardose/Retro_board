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

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColumnDef {
  key: NoteCategory;
  label: string;
  emoji: string;
  widthFraction: number;
  bg: string;
  headerBg: string;
  headerText: string;
  dividerColor: string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: "went-well",
    label: "Went Well",
    emoji: "✅",
    widthFraction: 1 / 3,
    bg: "bg-emerald-50/60",
    headerBg: "bg-emerald-100",
    headerText: "text-emerald-800",
    dividerColor: "border-emerald-200",
  },
  {
    key: "needs-improvement",
    label: "Needs Improvement",
    emoji: "🔧",
    widthFraction: 1 / 3,
    bg: "bg-amber-50/60",
    headerBg: "bg-amber-100",
    headerText: "text-amber-800",
    dividerColor: "border-amber-200",
  },
  {
    key: "action-items",
    label: "Action Items",
    emoji: "🚀",
    widthFraction: 1 / 3,
    bg: "bg-sky-50/60",
    headerBg: "bg-sky-100",
    headerText: "text-sky-800",
    dividerColor: "border-sky-200",
  },
];

export const CANVAS_WIDTH = 4000;
export const CANVAS_HEIGHT = 3000;

const MIN_SCALE = 0.15;
const MAX_SCALE = 3.0;
const WHEEL_SENSITIVITY = 0.001;

/**
 * Given a note's X coordinate (in canvas space), determine which column it
 * belongs to. Exported so StickyNote drag-end can call it directly if needed.
 */
export function categoryFromX(x: number): NoteCategory {
  let accumulated = 0;
  for (const col of COLUMNS) {
    accumulated += col.widthFraction * CANVAS_WIDTH;
    if (x < accumulated) return col.key;
  }
  return COLUMNS[COLUMNS.length - 1].key;
}

// ─── Transform state ──────────────────────────────────────────────────────────

interface Transform {
  x: number; // canvas translateX in screen pixels
  y: number; // canvas translateY in screen pixels
  scale: number;
}

// ─── Remote cursor ────────────────────────────────────────────────────────────

interface RemoteCursorProps {
  peer: AwarenessUser;
}

const RemoteCursor: React.FC<RemoteCursorProps> = ({ peer }) => {
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
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}
      >
        <path
          d="M3 2L16 10L9.5 11.5L6.5 18L3 2Z"
          fill={peer.color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
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

// ─── Column background layer ──────────────────────────────────────────────────

const ColumnLayer: React.FC = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      pointerEvents: "none",
    }}
  >
    {COLUMNS.map((col, i) => (
      <div
        key={col.key}
        style={{ width: `${col.widthFraction * 100}%`, flexShrink: 0 }}
        className={`
          relative h-full
          ${col.bg}
          ${i < COLUMNS.length - 1 ? `border-r-2 ${col.dividerColor}` : ""}
        `}
      >
        {/* Column header — not sticky in the canvas since the whole board
            pans; it's pinned at y=0 in canvas space which is always visible
            near the top when zoomed out normally. */}
        <div
          className={`
            flex items-center gap-2
            px-5 py-3
            ${col.headerBg} ${col.headerText}
            border-b-2 ${col.dividerColor}
            shadow-sm
          `}
        >
          <span className="text-lg leading-none">{col.emoji}</span>
          <span className="font-bold text-sm tracking-wide uppercase">
            {col.label}
          </span>
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
  onAddNote: (x: number, y: number) => void;
  onUpdateNote: (id: string, patch: Partial<Omit<NoteData, "id">>) => void;
  onDeleteNote: (id: string) => void;
  onUpvoteNote: (id: string) => void;
  onBringToFront: (id: string) => void;
  onToggleReveal: () => void;
  roomId: string;
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

/**
 * Canvas — v4 (custom pan/zoom, zero library dependencies for navigation)
 *
 * Navigation model (Figma-parity):
 *   Space + Left-drag         → pan
 *   Middle-Mouse-Button drag  → pan
 *   Ctrl/Meta + Wheel         → zoom centered on cursor (also captures trackpad pinch)
 *   Wheel (no modifier)       → pan canvas (trackpad two-finger scroll)
 *   Double-click              → add note at cursor position
 *
 * Architecture:
 *   - `viewportRef`  — the fixed-size outer div that fills the screen. All
 *     pointer events are attached here. Never transformed.
 *   - `canvasRef`    — the 4000×3000 inner div. Receives a CSS
 *     `transform: translate(x,y) scale(s)` driven by `transform` state.
 *     This is the coordinate space all note x/y values live in.
 *   - All coordinate math converts screen-space pointer positions into
 *     canvas-space via:  canvasX = (screenX - transform.x) / transform.scale
 *
 * UI separation:
 *   - The floating action dock is `position: fixed`, rendered OUTSIDE the
 *     viewport div entirely, so it is 100% immune to pan/zoom transforms.
 */
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
  const canvasRef = useRef<HTMLDivElement>(null);

  // ── Transform state ───────────────────────────────────────────────────────
  // Using a ref for the "live" value during pointer events (avoids stale
  // closures inside event listeners) and mirroring to React state only when
  // we need to trigger a re-render (i.e. to pass `scale` down to StickyNote).
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const [scale, setScale] = useState(1);

  const applyTransform = useCallback((t: Transform) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    canvas.style.transformOrigin = "0 0";
    transformRef.current = t;
  }, []);

  // ── Set initial position on mount ─────────────────────────────────────────
  // Centers the board horizontally in the viewport at scale 1, with a small
  // top margin so the column headers are immediately visible. Never uses
  // `centerOnInit` or `fitToScreen` — those cause the micro-scale bug.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vw = viewport.clientWidth;
    // Center the board horizontally; give 24px headroom at the top.
    const initialX = Math.max(0, (vw - CANVAS_WIDTH) / 2);
    const initialY = 24;
    const initial: Transform = { x: initialX, y: initialY, scale: 1 };
    applyTransform(initial);
    setScale(1);
  }, [applyTransform]);

  // ── Spacebar panning gate ─────────────────────────────────────────────────
  const spacePressed = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false); // drives cursor class only

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "textarea" || tag === "input") return;
      e.preventDefault();
      if (!spacePressed.current) {
        spacePressed.current = true;
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spacePressed.current = false;
      setSpaceDown(false);
      // Always cancel any in-progress pan
      panAnchor.current = null;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ── Pan via Space+drag ────────────────────────────────────────────────────
  // Anchor stores the pointer position at drag-start and the transform at
  // that moment; each move recomputes the delta from the anchor.
  const panAnchor = useRef<{
    pointerX: number;
    pointerY: number;
    tx: number;
    ty: number;
  } | null>(null);

  const handleViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Two ways to start a canvas pan:
      //   1. Space + Left-click (button 0) — Figma primary shortcut
      //   2. Middle-Mouse-Button click (button 1) — Figma secondary shortcut
      const isSpacePan = spacePressed.current && e.button === 0;
      const isMMBPan = e.button === 1;

      if (!isSpacePan && !isMMBPan) return;

      // Don't steal a click that landed on a sticky note.
      if ((e.target as HTMLElement).closest("[data-note-root]")) return;

      // Prevent the browser's default MMB auto-scroll mode (the crosshair
      // panning widget that appears on middle-click in most browsers).
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      const t = transformRef.current;
      panAnchor.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        tx: t.x,
        ty: t.y,
      };
    },
    []
  );

  const handleViewportPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // ── Cursor broadcast (always) ────────────────────────────────────────
      const t = transformRef.current;
      const canvasX = (e.clientX - t.x) / t.scale;
      const canvasY = (e.clientY - t.y) / t.scale;
      onUpdateCursor(canvasX, canvasY);

      // ── Pan (only when anchor is set) ────────────────────────────────────
      if (!panAnchor.current) return;
      const dx = e.clientX - panAnchor.current.pointerX;
      const dy = e.clientY - panAnchor.current.pointerY;
      applyTransform({
        ...t,
        x: panAnchor.current.tx + dx,
        y: panAnchor.current.ty + dy,
      });
    },
    [onUpdateCursor, applyTransform]
  );

  const handleViewportPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panAnchor.current) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        panAnchor.current = null;
      }
    },
    []
  );

  // ── Wheel: zoom or pan depending on modifier keys ─────────────────────────
  //
  // BRANCH A — Zoom  (ctrlKey || metaKey is true)
  //   Triggered by:
  //     • Ctrl + mouse wheel  (Windows / Linux)
  //     • Cmd  + mouse wheel  (macOS)
  //     • Trackpad pinch-to-zoom (browser synthesises ctrlKey=true for pinch)
  //   Formula: Figma's cursor-anchored zoom —
  //     newTranslate = cursorScreen - (cursorScreen - oldTranslate) × (newScale / oldScale)
  //   e.preventDefault() is essential here to suppress the browser's own
  //   page-zoom on Ctrl+scroll.
  //
  // BRANCH B — Pan  (no modifier keys)
  //   Triggered by:
  //     • Trackpad two-finger scroll (deltaX + deltaY, DOM_DELTA_PIXEL mode)
  //     • Mouse wheel vertical scroll (deltaY only, may be DOM_DELTA_LINE)
  //   The OS-provided pixel deltas map directly to screen-space translation.
  //   We do NOT divide by scale: a 50px finger movement should always move
  //   the canvas 50px on screen, regardless of zoom level. Dividing by scale
  //   would cause sluggish panning at high zoom and erratic panning at low
  //   zoom — the opposite of natural scroll feel.
  //   e.preventDefault() stops the browser from scrolling the page.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      // Always prevent default: stops browser zoom (Ctrl+scroll) and page
      // scroll (two-finger swipe) from interfering with canvas navigation.
      e.preventDefault();

      const t = transformRef.current;

      // ── BRANCH A: Zoom ──────────────────────────────────────────────────
      if (e.ctrlKey || e.metaKey) {
        // Normalize delta across input devices and browsers:
        //   DOM_DELTA_LINE (deltaMode 1) — standard mouse wheel in Firefox;
        //     each tick is one "line" (~20px equivalent). Multiply to get px.
        //   DOM_DELTA_PIXEL (deltaMode 0) — trackpad pinch and Chrome wheel;
        //     values are already in pixels, use directly.
        //   DOM_DELTA_PAGE (deltaMode 2) — rare; treat same as line mode.
        const rawDelta =
          e.deltaMode === 0
            ? e.deltaY                  // pixel mode — trackpad pinch, Chrome
            : e.deltaY * 20;            // line/page mode — Firefox mouse wheel

        const zoomFactor = 1 - rawDelta * WHEEL_SENSITIVITY;
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, t.scale * zoomFactor)
        );

        if (newScale === t.scale) return;

        // Pointer position relative to the viewport's top-left corner.
        // getBoundingClientRect is cheap here (called on wheel, not rAF).
        const viewportRect = viewport.getBoundingClientRect();
        const px = e.clientX - viewportRect.left;
        const py = e.clientY - viewportRect.top;

        // Figma cursor-anchored zoom formula — keeps the canvas point that
        // sits under the cursor perfectly stationary as scale changes.
        const newX = px - (px - t.x) * (newScale / t.scale);
        const newY = py - (py - t.y) * (newScale / t.scale);

        applyTransform({ x: newX, y: newY, scale: newScale });
        // Trigger a React re-render only for scale so StickyNote receives the
        // updated value for its own pointer-capture drag math.
        setScale(newScale);
        return;
      }

      // ── BRANCH B: Pan ───────────────────────────────────────────────────
      // deltaX drives horizontal pan (trackpad horizontal swipe).
      // deltaY drives vertical pan   (trackpad vertical swipe / mouse wheel).
      // Both arrive in DOM_DELTA_PIXEL for trackpads (mode 0).
      // Mouse wheel without a modifier sends deltaY in DOM_DELTA_LINE (mode 1)
      // for Firefox, so we normalise that to pixels too.
      const dx = e.deltaMode === 0 ? e.deltaX : e.deltaX * 20;
      const dy = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;

      // Subtract because scrolling "down" (positive deltaY) should move the
      // canvas upward (negative translateY), matching natural scroll direction.
      applyTransform({
        ...t,
        x: t.x - dx,
        y: t.y - dy,
      });
      // No setScale call — scale didn't change, no re-render needed.
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyTransform]);

  // ── Note creation on double-click ─────────────────────────────────────────
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Ignore clicks that land on an existing note
      if ((e.target as HTMLElement).closest("[data-note-root]")) return;

      const t = transformRef.current;
      // Convert screen coords to canvas coords, then offset so the note's
      // center lands under the cursor (note is 220px wide × ~140px tall).
      const canvasX = (e.clientX - t.x) / t.scale - 110;
      const canvasY = (e.clientY - t.y) / t.scale - 60;
      onAddNote(Math.max(0, canvasX), Math.max(0, canvasY));
    },
    [onAddNote]
  );

  // ── "Add note" from dock button ───────────────────────────────────────────
  // Places a note at the visible center of the current viewport.
  const handleAddNoteFromDock = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const t = transformRef.current;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    // Center of the current view in canvas space
    const canvasX = (vw / 2 - t.x) / t.scale - 110;
    const canvasY = (vh / 2 - t.y) / t.scale - 60;
    onAddNote(Math.max(0, canvasX), Math.max(0, canvasY));
  }, [onAddNote]);

  // ── Note drag-end: recalculate category from final X ─────────────────────
  const handleNoteDragEnd = useCallback(
    (id: string, finalX: number) => {
      const category = categoryFromX(finalX);
      onUpdateNote(id, { category });
    },
    [onUpdateNote]
  );

  // ── PNG export ────────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    const node = canvasRef.current;
    if (!node) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#f1f5f9",
        // Capture the element at its natural 4000×3000 size, ignoring the
        // current CSS transform, so the exported PNG is always full-res.
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        style: {
          transform: "none",
          transformOrigin: "0 0",
        },
      });
      const link = document.createElement("a");
      link.download = `retro-board-${roomId}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setIsExporting(false);
    }
  }, [roomId]);

  const remotePeers = peers.filter((p) => p.clientId !== localClientId);

  return (
    <>
      {/* ── Viewport ───────────────────────────────────────────────────────
           Fills the remaining screen area below any app header. Owns all
           pointer / wheel events. Never itself transformed.
      ───────────────────────────────────────────────────────────────────── */}
      <div
        ref={viewportRef}
        className="relative flex-1 overflow-hidden"
        style={{
          cursor: spaceDown ? "grab" : "crosshair",
          backgroundImage:
            "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          backgroundColor: "#f1f5f9",
          // Dot-grid background is fixed in screen space, so it doesn't
          // scroll with the canvas — gives an "infinite canvas" feel.
          backgroundAttachment: "local",
        }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* ── Canvas (4000 × 3000) ─────────────────────────────────────────
             Positioned at (0,0) relative to the viewport; the CSS transform
             set by `applyTransform` handles all pan and zoom. transform-
             origin is "0 0" so scale math is trivially `(point - translate)
             / scale`.
        ──────────────────────────────────────────────────────────────────── */}
        <div
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            backgroundColor: "#f1f5f9",
            // transformOrigin and initial transform applied in useLayoutEffect
          }}
        >
          {/* Column tinted backgrounds + headers — below all notes */}
          <ColumnLayer />

          {/* ── Sticky notes ──────────────────────────────────────────────── */}
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
            />
          ))}

          {/* ── Remote cursors ────────────────────────────────────────────── */}
          {remotePeers.map((peer) => (
            <RemoteCursor key={peer.clientId} peer={peer} />
          ))}
        </div>

        {/* ── Empty-state hint ──────────────────────────────────────────────
             Rendered inside viewport (not canvas) so it's always centered in
             the visible area, regardless of pan/zoom state.
        ──────────────────────────────────────────────────────────────────── */}
        {notes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center bg-white/70 backdrop-blur-sm rounded-2xl px-8 py-6 shadow-sm border border-slate-200">
              <p className="text-3xl mb-2">✦</p>
              <p className="text-slate-600 font-medium text-sm">
                Double-click anywhere to add a note
              </p>
              <p className="text-slate-400 text-xs mt-1">
                Drop into columns · Space/MMB + drag to pan · Two-finger scroll · Pinch or Ctrl+scroll to zoom
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Floating action dock ─────────────────────────────────────────────
           Rendered as a sibling of the viewport div (not a child), and
           `position: fixed` — completely isolated from the canvas transform
           layer. z-[100] keeps it above everything including dragged notes.
      ──────────────────────────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]
                   flex items-center gap-2 px-3 py-2.5
                   bg-white/80 backdrop-blur-md
                   border border-slate-200/80
                   rounded-2xl shadow-xl shadow-slate-900/10"
        // Prevent double-click on the dock from creating a note
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {/* Divider helper */}
        <div className="w-px h-5 bg-slate-200 mx-0.5" />

        {/* Add Note */}
        <DockButton
          onClick={handleAddNoteFromDock}
          icon={<Plus size={15} />}
          label="Add note"
          variant="primary"
        />

        <div className="w-px h-5 bg-slate-200 mx-0.5" />

        {/* Reveal / Hide */}
        <DockButton
          onClick={onToggleReveal}
          icon={
            boardSettings.isRevealed ? (
              <EyeOff size={15} />
            ) : (
              <Eye size={15} />
            )
          }
          label={boardSettings.isRevealed ? "Hide notes" : "Reveal notes"}
          variant={boardSettings.isRevealed ? "active" : "default"}
        />

        {/* Export */}
        <DockButton
          onClick={handleExport}
          disabled={isExporting}
          icon={<Download size={15} />}
          label={isExporting ? "Exporting…" : "Export PNG"}
          variant="default"
        />
      </div>
    </>
  );
};

// ─── Dock button ──────────────────────────────────────────────────────────────

interface DockButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  variant?: "default" | "primary" | "active";
  disabled?: boolean;
}

const DockButton: React.FC<DockButtonProps> = ({
  onClick,
  icon,
  label,
  variant = "default",
  disabled = false,
}) => {
  const base =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold " +
    "transition-all duration-150 active:scale-95 select-none whitespace-nowrap ";

  const variants: Record<string, string> = {
    default:
      "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200",
    primary:
      "bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 shadow-sm",
    active:
      "bg-violet-600 hover:bg-violet-700 text-white border border-violet-700 shadow-sm",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${disabled ? "opacity-50 cursor-wait" : ""}`}
      aria-label={label}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};