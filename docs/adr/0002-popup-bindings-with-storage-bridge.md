# Remappable bindings via popup plus isolated-world storage bridge

Custom Bindings are edited in an extension popup grouped by Hints /
Navigation / Player, stored in `chrome.storage.sync`, and relayed live to
the MAIN-world content script through an isolated-world bridge that
re-broadcasts them as a `keytube:bindings` window event. Uniqueness is
enforced per matching namespace (single-press vs Chord-second), Esc and
1–9 stay fixed, and bare YouTube-native keys show an inline warning.

## Considered Options

- `chrome.commands` in the manifest: native remap UI and OS-level handling,
  but a tiny fixed command set, no Chords, no per-namespace uniqueness, and
  no inline native-key warnings.
- Content script reads storage directly: impossible — the hot-path script
  runs in MAIN world for capture-phase priority and MAIN cannot touch
  `chrome.*` APIs.
- Options page instead of popup: more room, but slower to reach mid-browse;
  popup keeps record-one-key a two-click flow.

## Consequences

- `bindings-defaults.js` is the single source of Actions, defaults, and the
  native-warn list, loaded by MAIN content, bridge, and popup — no drift.
- Popup writes storage only; bridge `onChanged` relay gives instant apply to
  open tabs with zero reload plumbing in the hot path.
- Modifier combos required dropping the blanket ctrl/meta/alt early-return;
  browser shortcuts stay safe via exact-match plus pass-through while armed.
