Here’s the updated README that reflects all the fixes and enhancements from the latest changes—cleaner UI, better interactions, and the new features.

---

```markdown
# RetroBoard

A real‑time collaborative retrospective board for agile teams. Create, organise, and vote on sticky notes across classic retro columns—**Went Well**, **Needs Improvement**, and **Action Items**—all synced instantly with your team.


---

## ✨ Features

- **Live Collaboration** – Powered by Yjs, all cursors, notes, and votes stay in sync across every participant.
- **Infinite Canvas** – Pan and zoom with intuitive controls:
  - **Left‑click + drag** on empty space (like Figma/Canva).
  - **Right‑click + drag** also pans (context menu is blocked).
  - **Middle‑click + drag** or **Space + drag** as alternatives.
  - **Ctrl/Cmd + scroll** to zoom (anchored to your cursor) – zoom level is shown in the floating dock.
  - Two‑finger scroll to pan.
- **Sticky Notes** – Create, edit, and drag notes by clicking **anywhere** on the note body (not just the handle). Drag can be cancelled with the **Escape** key.
- **Auto‑focus** – Newly created notes automatically focus their textarea, so you can start typing immediately.
- **Retro Columns** – Notes automatically snap to columns based on their X position.
- **Voting** – 👍 upvote notes to highlight what matters.
- **Reveal Mode** – Hide note content until the facilitator reveals it, perfect for anonymous retro sessions.
- **Export PNG** – Capture the entire board at full resolution (4000×3000).
- **Presence** – See who’s online and their live cursor.
- **Clean UI** – Single floating action dock with all controls (no duplicate buttons).
- **Dark‑mode ready** (UI uses Tailwind, easy to theme).

---

## 🛠️ Tech Stack

| Layer        | Technology                                                   |
|--------------|--------------------------------------------------------------|
| Frontend     | React (TypeScript)                                           |
| State / Sync | Yjs, `wss://demos.yjs.dev` (WebSocket provider)              |
| Styling      | Tailwind CSS + PostCSS                                       |
| Build Tool   | Vite                                                         |
| UI Icons     | Lucide React                                                 |
| Export       | `html-to-image`                                              |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or later)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/retroboard.git
cd retroboard

# Install dependencies
npm install
# or
yarn install
```

### Run Locally

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:5173](http://localhost:5173) to view it in the browser. The app will automatically connect to the Yjs demo WebSocket server at `wss://demos.yjs.dev`.

---

## 🧠 How It Works

### Architecture Overview

- **`Canvas.tsx`** – Manages pan/zoom, column backgrounds, note placement, and remote cursors. Handles all pointer and wheel events. Exports `NOTE_WIDTH` constant for consistent sizing.
- **`StickyNote.tsx`** – Renders a single note with drag (on any part), text editing, color picker, votes, reveal protection, and Escape‑to‑cancel drag.
- **`useMultiplayerRoom`** – Custom hook that wraps Yjs and provides `notes`, `peers`, `updateNote`, `bringToFront`, and other actions. Mutations write directly to Yjs.
- **Column system** – Notes are categorised by their horizontal position. The `categoryFromX` function determines the column based on predefined width fractions.

### Navigation Model

The canvas is a fixed‑size div (4000×3000) that is **transformed** using CSS `translate` and `scale`. All note coordinates are stored in this canvas coordinate space.

- Panning adjusts the `translate` values.
- Zooming adjusts the `scale` value and recalculates `translate` to keep the cursor‑anchored point fixed.
- Pointer events are captured on the viewport, converted to canvas space using `(clientX - translate) / scale`.

### Collaboration

- Each note carries a `lastUpdatedBy` field (the user name of the last editor).
- Yjs synchronises all changes (add, move, edit, delete, upvote) in real time.
- Presence data (cursors, colours, names) is shared via Yjs awareness.
- `zIndex` is managed automatically: bringing a note to the front updates its `zIndex` to `maxZIndex + 1`, ensuring a proper stacking order.

### Reveal Mode

- When `isRevealed` is `false`, notes not authored by the local user have their text blurred with a "Hidden until reveal" badge.
- The facilitator toggles this state, and it syncs to all clients.

---

## 🎮 Usage

- **Add a note** – Double‑click anywhere on the canvas, or use the floating **Add note** button. The note appears near the viewport center and the textarea is auto‑focused.
- **Drag a note** – Click and drag anywhere on the note body (not just the handle) to reposition it. The note automatically updates its column category on drop. Press **Escape** to cancel the drag and return the note to its start position.
- **Edit a note** – Click inside the note’s text area and type. Changes are saved on blur.
- **Change color** – Click one of the four colour dots in the note header.
- **Upvote** – Click the 👍 button at the bottom of a note.
- **Delete** – Click the ✕ button in the note header.
- **Pan** – Left‑click, right‑click, or middle‑click on empty canvas and drag. Alternatively, hold `Space` and drag.
- **Zoom** – Hold `Ctrl` (or `Cmd` on macOS) and scroll. Pinch‑to‑zoom on trackpads works as well. The current zoom percentage is displayed in the floating dock.
- **Reveal / Hide** – Use the floating dock button to toggle note visibility for all participants.
- **Export** – Click the export button to download a high‑resolution PNG of the entire board.

---

## 🔧 Configuration

### Changing the Board Size

Modify `CANVAS_WIDTH` and `CANVAS_HEIGHT` in `Canvas.tsx`. The column widths are calculated as fractions of the total width.

### Customising Columns

Edit the `COLUMNS` array in `Canvas.tsx`. Each column has a `key`, `label`, `emoji`, and styling classes.

### Changing the WebSocket Provider

In `useMultiplayerRoom`, the default provider is `wss://demos.yjs.dev`. Replace it with your own Yjs WebSocket server if needed.

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

### Development Notes

- The project uses strict TypeScript and ESLint.
- Tailwind is configured with a minimal custom theme (see `tailwind.config.js` – not shown, but standard).
- To run tests (if any): `npm run test`

---

## 📄 License

MIT © [Your Name/Organization]

---

## 🙏 Acknowledgements

- [Yjs](https://yjs.dev/) – CRDT framework for real‑time collaboration.
- [Lucide](https://lucide.dev/) – Icons.
- [html-to-image](https://github.com/bubkoo/html-to-image) – PNG export.

---

**Built with ❤️ for agile teams everywhere.**
```
