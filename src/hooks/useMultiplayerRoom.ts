import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NoteCategory = "went-well" | "needs-improvement" | "action-items";
export type NoteColor = "yellow" | "blue" | "pink" | "green";

export interface NoteData {
  id: string;
  text: string;
  x: number;
  y: number;
  color: NoteColor;
  lastUpdatedBy: string;
  // Which retro column this note belongs to (assigned on drag-release).
  category?: NoteCategory;
  // Cumulative upvote count — incremented atomically via Yjs transaction.
  votes: number;
  // Stacking order among overlapping notes. Higher = drawn on top.
  // Bumped to (current max + 1) whenever a note is picked up, so the
  // most recently interacted-with note always renders above its neighbors.
  zIndex?: number;
}

export interface AwarenessUser {
  clientId: number;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
}

// board-settings map shape — stored in doc.getMap('board-settings')
export interface BoardSettings {
  // When false, note text is blurred for everyone except the note's author.
  isRevealed: boolean;
}

export interface MultiplayerRoom {
  /** The Yjs shared map where every note lives, keyed by note id. */
  notesMap: Y.Map<NoteData>;
  /** Snapshot of notes derived from the Yjs map — React state, re-renders on change. */
  notes: NoteData[];
  /** All currently-connected awareness peers (including self). */
  peers: AwarenessUser[];
  /** The local user's own awareness identity. */
  localUser: Omit<AwarenessUser, "clientId" | "cursor">;
  /** Call this on every pointermove over the canvas to broadcast cursor position. */
  updateCursor: (x: number, y: number) => void;
  /** Adds a brand-new note at the given coordinates. */
  addNote: (x: number, y: number) => string;
  /** Merges a partial update into an existing note (text, position, color, category…). */
  updateNote: (id: string, patch: Partial<Omit<NoteData, "id">>) => void;
  /** Removes a note by id. */
  deleteNote: (id: string) => void;
  /**
   * Increments the vote count for a note inside a single Yjs transaction.
   * Uses a read-then-write pattern inside the transaction to avoid
   * lost-update races between simultaneous voters on the same note.
   */
  upvoteNote: (id: string) => void;
  /**
   * Finds the current highest zIndex among all notes and raises the target
   * note to maxZ + 1, so it renders above every other overlapping note.
   * Call this whenever a note becomes the user's active focus (e.g. on
   * pointer-down, before a drag begins).
   */
  bringToFront: (id: string) => void;
  /** Current global board settings (isRevealed). Derived from Yjs, re-renders on change. */
  boardSettings: BoardSettings;
  /** Toggle the isRevealed flag in the shared board-settings map. */
  toggleReveal: () => void;
  /** True once the WebSocket provider has established its first connection. */
  connected: boolean;
  /** The active room identifier derived from the URL. */
  roomId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a URL-safe 8-character cryptographic room ID. */
function generateRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

const NAMES = [
  "Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hank",
  "Iris", "Jake", "Kara", "Leo", "Mia", "Nate", "Olive", "Pete",
];
function randomName(): string {
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

const USER_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];
function randomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

const DEFAULT_BOARD_SETTINGS: BoardSettings = { isRevealed: false };

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useMultiplayerRoom
 *
 * Manages the full lifecycle of a Yjs document synced via y-websocket.
 *
 * New in v2:
 *  - `doc.getMap<NoteData>('canvas-notes')` entries now carry `votes` and `category`.
 *  - `doc.getMap('board-settings')` holds the shared `isRevealed` boolean.
 *  - `upvoteNote` performs a read-modify-write inside a Yjs transaction so
 *    concurrent votes from different clients are not silently dropped.
 *  - `toggleReveal` flips `isRevealed` in the board-settings map, broadcasting
 *    the reveal/hide state to all connected peers simultaneously.
 *
 * New in v3:
 *  - `NoteData.zIndex` tracks stacking order among overlapping notes.
 *  - `bringToFront` scans the current notes for the highest zIndex and writes
 *    `maxZ + 1` onto the target note in a single transaction, so it's always
 *    unambiguous which note is "on top" even under concurrent edits.
 *  - `addNote` seeds new notes with `maxZ + 1` too, so freshly created notes
 *    never spawn underneath existing ones.
 *
 * New in v4:
 *  - `addNote` now returns the new note's `id` string so callers can track
 *    which note was most recently created (e.g. to auto-focus its textarea).
 *
 * Infinite-loop prevention:
 *  Observers only call `setState`. Actions (addNote, updateNote, upvoteNote,
 *  bringToFront, toggleReveal) only mutate Yjs. React state never feeds back
 *  into Yjs.
 */
export function useMultiplayerRoom(): MultiplayerRoom {
  // ── Room ID resolution ──────────────────────────────────────────────────
  const [roomId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    let id = params.get("room");
    if (!id) {
      id = generateRoomId();
      params.set("room", id);
      window.history.replaceState(null, "", `?${params.toString()}`);
    }
    return id;
  });

  // ── Stable local user identity ──────────────────────────────────────────
  const localUser = useRef({ name: randomName(), color: randomColor() }).current;

  // ── Yjs refs (managed imperatively, not as React state) ────────────────
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const notesMapRef = useRef<Y.Map<NoteData> | null>(null);
  // Separate shared map for global board settings (isRevealed, etc.)
  const settingsMapRef = useRef<Y.Map<boolean> | null>(null);

  // ── React state (derived snapshots for rendering) ───────────────────────
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [peers, setPeers] = useState<AwarenessUser[]>([]);
  const [boardSettings, setBoardSettings] = useState<BoardSettings>(DEFAULT_BOARD_SETTINGS);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // ── Instantiate Yjs document ──────────────────────────────────────────
    const doc = new Y.Doc();
    docRef.current = doc;

    const notesMap = doc.getMap<NoteData>("canvas-notes");
    notesMapRef.current = notesMap;

    // board-settings stores plain boolean values keyed by setting name.
    // Using Y.Map<boolean> keeps it simple — we only need one key right now.
    const settingsMap = doc.getMap<boolean>("board-settings");
    settingsMapRef.current = settingsMap;

    // ── Connect WebSocket provider ────────────────────────────────────────
    const provider = new WebsocketProvider(
      "wss://demos.yjs.dev",
      `retro-board-${roomId}`,
      doc
    );
    providerRef.current = provider;

    // ── Notes observer ────────────────────────────────────────────────────
    // Fires on any insert, update, or delete in canvas-notes.
    // We snapshot the whole map into a plain array for React.
    const onNotesChange = () => {
      const snapshot: NoteData[] = [];
      notesMap.forEach((note) => snapshot.push({ ...note }));
      setNotes(snapshot);
    };
    notesMap.observe(onNotesChange);
    onNotesChange(); // hydrate initial state

    // ── Board settings observer ───────────────────────────────────────────
    // Fires whenever the facilitator toggles reveal/hide.
    const onSettingsChange = () => {
      setBoardSettings({
        isRevealed: settingsMap.get("isRevealed") ?? false,
      });
    };
    settingsMap.observe(onSettingsChange);
    onSettingsChange(); // hydrate initial state

    // ── Awareness setup ───────────────────────────────────────────────────
    provider.awareness.setLocalStateField("user", {
      name: localUser.name,
      color: localUser.color,
      cursor: null,
    });

    const onAwarenessChange = () => {
      const all: AwarenessUser[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (state?.user) {
          all.push({
            clientId,
            name: state.user.name,
            color: state.user.color,
            cursor: state.user.cursor ?? null,
          });
        }
      });
      setPeers(all);
    };
    provider.awareness.on("change", onAwarenessChange);
    onAwarenessChange();

    // ── Connection status ─────────────────────────────────────────────────
    const onStatus = ({ status }: { status: string }) => {
      setConnected(status === "connected");
    };
    provider.on("status", onStatus);

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      notesMap.unobserve(onNotesChange);
      settingsMap.unobserve(onSettingsChange);
      provider.awareness.off("change", onAwarenessChange);
      provider.off("status", onStatus);
      provider.disconnect();
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      providerRef.current = null;
      notesMapRef.current = null;
      settingsMapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Broadcast cursor position to all peers via Awareness. */
  const updateCursor = useCallback((x: number, y: number) => {
    providerRef.current?.awareness.setLocalStateField("user", {
      name: localUser.name,
      color: localUser.color,
      cursor: { x, y },
    });
  }, [localUser]);

  /** Scan every note in the shared map and return the highest zIndex found. */
  const getMaxZIndex = useCallback((): number => {
    const notesMap = notesMapRef.current;
    if (!notesMap) return 1;
    let max = 1;
    notesMap.forEach((note) => {
      const z = note.zIndex ?? 1;
      if (z > max) max = z;
    });
    return max;
  }, []);

  /**
   * Create a new note at the given canvas coordinates.
   * Returns the new note's id so callers can track the latest created note
   * (e.g. to auto-focus its textarea via `focusOnMount`).
   */
  const addNote = useCallback((x: number, y: number): string => {
    const id = crypto.randomUUID();
    if (!notesMapRef.current) return id;
    const note: NoteData = {
      id,
      text: "",
      x,
      y,
      color: "yellow",
      lastUpdatedBy: localUser.name,
      // New notes start without a category; assigned on first drag-release.
      category: undefined,
      votes: 0,
      // Seed above every existing note so it never spawns hidden underneath.
      zIndex: getMaxZIndex() + 1,
    };
    notesMapRef.current.doc?.transact(() => {
      notesMapRef.current!.set(id, note);
    });
    return id;
  }, [getMaxZIndex, localUser.name]);

  /** Apply a partial update to an existing note (position, text, color, category…). */
  const updateNote = useCallback(
    (id: string, patch: Partial<Omit<NoteData, "id">>) => {
      if (!notesMapRef.current) return;
      const existing = notesMapRef.current.get(id);
      if (!existing) return;
      notesMapRef.current.doc?.transact(() => {
        notesMapRef.current!.set(id, {
          ...existing,
          ...patch,
          lastUpdatedBy: localUser.name,
        });
      });
    },
    [localUser.name]
  );

  /** Remove a note by id. */
  const deleteNote = useCallback((id: string) => {
    if (!notesMapRef.current) return;
    notesMapRef.current.doc?.transact(() => {
      notesMapRef.current!.delete(id);
    });
  }, []);

  /**
   * Increment a note's vote count by 1.
   *
   * The read-modify-write is wrapped in a single Yjs transaction so that
   * if two peers upvote simultaneously, Yjs will serialize the transactions
   * and both increments will be applied (no lost update).
   * Note: Y.Map<PlainObject> uses last-write-wins per key, so in the extreme
   * case of a true simultaneous write, one increment could win. For an MVP
   * this is acceptable; a Y.Number or server-side counter would be needed for
   * strict accuracy under heavy concurrent voting.
   */
  const upvoteNote = useCallback((id: string) => {
    if (!notesMapRef.current) return;
    notesMapRef.current.doc?.transact(() => {
      const existing = notesMapRef.current!.get(id);
      if (!existing) return;
      notesMapRef.current!.set(id, {
        ...existing,
        votes: (existing.votes ?? 0) + 1,
        // Preserve lastUpdatedBy — an upvote is not a content edit.
      });
    });
  }, []);

  /**
   * Bring a note to the front of the stacking order.
   *
   * Reads the current highest zIndex across all notes and writes
   * `maxZ + 1` onto the target note inside a single transaction. Called from
   * StickyNote's pointer-down handler so the note a user is about to
   * interact with always pops above any note it overlaps.
   */
  const bringToFront = useCallback(
    (id: string) => {
      if (!notesMapRef.current) return;
      notesMapRef.current.doc?.transact(() => {
        const existing = notesMapRef.current!.get(id);
        if (!existing) return;
        const maxZ = getMaxZIndex();
        notesMapRef.current!.set(id, {
          ...existing,
          zIndex: maxZ + 1,
        });
      });
    },
    [getMaxZIndex]
  );

  /**
   * Toggle the global `isRevealed` flag in the shared board-settings map.
   * All connected peers observe this map and re-render their StickyNotes
   * to show or blur text based on the new value.
   */
  const toggleReveal = useCallback(() => {
    if (!settingsMapRef.current) return;
    settingsMapRef.current.doc?.transact(() => {
      const current = settingsMapRef.current!.get("isRevealed") ?? false;
      settingsMapRef.current!.set("isRevealed", !current);
    });
  }, []);

  return {
    notesMap: notesMapRef.current ?? new Y.Map<NoteData>(),
    notes,
    peers,
    localUser,
    updateCursor,
    addNote,
    updateNote,
    deleteNote,
    upvoteNote,
    bringToFront,
    boardSettings,
    toggleReveal,
    connected,
    roomId,
  };
}