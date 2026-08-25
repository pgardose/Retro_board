/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ── Typography ────────────────────────────────────────────────────────
      fontFamily: {
        // Inter as the primary UI face. system-ui as fallback so the page
        // never flashes a serif while the font loads.
        sans: ["Inter", "system-ui", "sans-serif"],
      },

      // ── Color tokens ──────────────────────────────────────────────────────
      // Named after the product domain, not the hue, so they read as
      // intentional decisions rather than Tailwind defaults.
      colors: {
        retro: {
          // Canvas surface — warm linen instead of cold slate
          canvas:   "#EDE9E3",
          // Top-bar / dock chrome
          chrome:   "#FFFFFF",
          // Dot-grid dots
          dot:      "#C4BDB5",

          // Column: Went Well — sage green
          "well-lane":   "#F1FAF4",
          "well-header": "#D5EDDA",
          "well-accent": "#2E7D52",  // 4px bottom-border + text
          "well-div":    "#B4D9BE",  // column separator

          // Column: Needs Improvement — warm amber paper
          "delta-lane":   "#FFFCF0",
          "delta-header": "#FDE9B0",
          "delta-accent": "#92600A",
          "delta-div":    "#F5D57A",

          // Column: Action Items — periwinkle blue
          "action-lane":   "#F0F5FF",
          "action-header": "#DBEAFE",
          "action-accent": "#1E4FBF",
          "action-div":    "#BFCFEF",

          // Brand accent used in buttons + upvotes
          brand:    "#4F46E5",  // indigo-600 equivalent — kept for continuity
        },
      },

      // ── Shadows ───────────────────────────────────────────────────────────
      boxShadow: {
        // Resting note — warm-toned, not the generic cold rgba(0,0,0,0.1)
        note: "0 2px 8px 0 rgba(60,45,20,0.09), 0 1px 2px 0 rgba(60,45,20,0.06)",
        // Lifted note during drag
        "note-drag": "0 12px 32px 0 rgba(60,45,20,0.18), 0 2px 6px 0 rgba(60,45,20,0.10)",
        // Dock glass panel
        dock: "0 8px 32px 0 rgba(30,20,10,0.10), 0 1px 4px 0 rgba(30,20,10,0.06)",
        // Top bar
        bar: "0 1px 0 0 rgba(60,45,20,0.08)",
      },

      // ── Border radius ─────────────────────────────────────────────────────
      borderRadius: {
        note: "10px",   // slightly softer than rounded-lg (8px) but less bubbly than xl (12px)
      },

      // ── Animation keyframes ───────────────────────────────────────────────
      keyframes: {
        // New-note entrance: quick pop from slightly small + faded
        "note-pop": {
          "0%":   { opacity: "0", transform: "scale(0.90)" },
          "60%":  { opacity: "1", transform: "scale(1.03)" },
          "100%": { opacity: "1", transform: "scale(1.00)" },
        },
        // Subtle pulse for the sync indicator dot
        "sync-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.4" },
        },
      },
      animation: {
        "note-pop":   "note-pop 220ms cubic-bezier(0.34,1.56,0.64,1) forwards",
        "sync-pulse": "sync-pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};