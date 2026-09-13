# First-install Tour as popup slideshow shown once, no replay

The Tour is a 5-slide overlay inside `popup.html` (Hint Mode, Chords,
Player, Feed/history, remappable-vs-fixed), rendered by `popup.js` from
live Bindings so it never drifts from shipped defaults. It appears on the
first popup open after install and disappears forever after Skip / Done
via a `keytube.tourSeen.v1` flag in `chrome.storage.local`. Closing the
popup mid-Tour leaves the flag unset, so the Tour resumes next open.

## Considered Options

- Dedicated welcome page opened by a service worker: standard pattern with
  room to explain, but needs a background worker solely for one redirect
  and leaves the popup context where remapping happens; rejected.
- In-page YouTube overlay tour: most contextual with live Badges, but
  coupled to volatile YouTube DOM; rejected for v1.
- Replay button: rescues users who dismiss too fast, but the owner wants
  strictly once-only with no replay UI; rejected.

## Consequences

- No background worker and no new permissions; the Tour is pure popup UI.
- The Tour is read-only: it never writes Bindings, only names live ones.
- Fixed keys stay fixed: Esc / 1–9 are never Actions, native-key overrides
  keep the existing inline `overrides YouTube X` warning story.
