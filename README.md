# RetroBoard

A real-time collaborative retrospective board for agile teams. Create, organize, and vote on sticky notes across classic retro columns—**Went Well**, **Needs Improvement**, and **Action Items**—all synced instantly with your team.

---

## ✨ Features

- **Live Collaboration** – Powered by Yjs, all cursors, notes, and votes stay in sync across every participant.
- **Infinite Canvas** – Pan and zoom with Figma‑like controls:
  - Space + drag or middle‑mouse drag to pan.
  - Ctrl/Cmd + scroll to zoom (anchored to your cursor).
  - Two‑finger scroll to pan.
- **Sticky Notes** – Create, edit, drag, color‑code, and delete notes.
- **Retro Columns** – Notes automatically snap to columns based on their X position.
- **Voting** – 👍 upvote notes to highlight what matters.
- **Reveal Mode** – Hide note content until the facilitator reveals it, perfect for anonymous retro sessions.
- **Export PNG** – Capture the entire board at full resolution (4000×3000).
- **Presence** – See who’s online and their live cursor.
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

- **`Canvas.tsx`** – Manages pan/zoom, column backgrounds, note placement, and remote cursors. Handles all pointer and wheel events.
- **`StickyNote.tsx`** – Renders a single note with drag, text editing, color picker, votes, and reveal protection.
- **`useMultiplayerRoom`** (not shown, but inferred) – A custom hook that wraps Yjs and provides `notes`, `peers`, `updateNote`, etc.
- **Column system** – Notes are categorized by their horizontal position. The `categoryFromX` function determines the column based on predefined width fractions.

### Navigation Model

The canvas is a fixed-size div (4000×3000) that is **transformed** using CSS `translate` and `scale`. All note coordinates are stored in this canvas coordinate space.

- Panning adjusts the `translate` values.
- Zooming adjusts the `scale` value and recalculates `translate` to keep the cursor‑anchored point fixed.
- Pointer events are captured on the viewport, converted to canvas space using `(clientX - translate) / scale`.

### Collaboration

- Each note carries a `lastUpdatedBy` field (the user name of the last editor).
- Yjs synchronizes all changes (add, move, edit, delete, upvote) in real time.
- Presence data (cursors, colors, names) is shared via Yjs awareness.

### Reveal Mode

- When `isRevealed` is `false`, notes not authored by the local user have their text blurred with a "Hidden until reveal" badge.
- The facilitator toggles this state, and it syncs to all clients.

---

## 🎮 Usage

- **Add a note** – Double‑click anywhere on the canvas, or use the floating **Add note** button.
- **Drag a note** – Grab the handle (six dots) at the top of a note and drag it to a new position. The note automatically updates its column category on drop.
- **Edit a note** – Click inside the note’s text area and type. Changes are saved on blur.
- **Change color** – Click one of the four color dots in the note header.
- **Upvote** – Click the 👍 button at the bottom of a note.
- **Delete** – Click the ✕ button in the note header.
- **Pan** – Hold `Space` and drag, or use middle‑mouse button drag.
- **Zoom** – Hold `Ctrl` (or `Cmd` on macOS) and scroll. Pinch‑to‑zoom on trackpads works as well.
- **Reveal / Hide** – Use the floating dock button to toggle note visibility for all participants.
- **Export** – Click the export button to download a high‑resolution PNG of the entire board.

---

## 🔧 Configuration

### Changing the Board Size

Modify `CANVAS_WIDTH` and `CANVAS_HEIGHT` in `Canvas.tsx`. The column widths are calculated as fractions of the total width.

### Customizing Columns

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

- [Yjs](https://yjs.dev/) – CRDT framework for real-time collaboration.
- [Lucide](https://lucide.dev/) – Icons.
- [html-to-image](https://github.com/bubkoo/html-to-image) – PNG export.

---

**Built with ❤️ for agile teams everywhere.**