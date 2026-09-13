// keytube shared Bindings catalogue — plain JS, no build, no deps.
// Loaded in three places: MAIN-world content.js (before it), the isolated
// bridge.js, and popup.js (via <script> tags). Everything hangs off
// globalThis.KEYTUBE so no module system is needed anywhere.
// Glossary: Action, Binding (see CONTEXT.md).
(() => {
  // A Binding is {key, ctrl, shift, alt, meta} or null (unassigned).
  // `key` is an e.key value ("g", "G", "Enter", " ", "[", "ArrowUp", "/").
  const B = (key, mods = {}) => ({
    key,
    ctrl: !!mods.ctrl,
    shift: !!mods.shift,
    alt: !!mods.alt,
    meta: !!mods.meta,
  });

  // namespace "single": matched on a bare keypress.
  // namespace "chord": matched only as the second press after the leader.
  // Sharing one Binding across namespaces is intentional (e.g. "t" is both
  // theater and the Chord second for trending); uniqueness is enforced
  // within a namespace, not across them.
  const ACTIONS = [
    { id: "hintArm", label: "Arm / exit Hint Mode", section: "Hints", ns: "single" },
    { id: "chordHome", label: "Chord: home", section: "Navigation", ns: "chord" },
    { id: "chordSubs", label: "Chord: subscriptions", section: "Navigation", ns: "chord" },
    { id: "chordTrending", label: "Chord: trending", section: "Navigation", ns: "chord" },
    { id: "chordHistory", label: "Chord: history", section: "Navigation", ns: "chord" },
    { id: "chordLibrary", label: "Chord: library", section: "Navigation", ns: "chord" },
    { id: "chordSearch", label: "Chord: focus search", section: "Navigation", ns: "chord" },
    { id: "historyBack", label: "History back", section: "Navigation", ns: "single" },
    { id: "historyForward", label: "History forward", section: "Navigation", ns: "single" },
    { id: "theater", label: "Theater mode", section: "Player", ns: "single" },
    { id: "speedToggle", label: "Toggle 2x speed", section: "Player", ns: "single" },
    { id: "nextInRail", label: "Open first video in Watch-next", section: "Player", ns: "single" },
    { id: "feedScrollUp", label: "Scroll Feed up", section: "Player", ns: "single" },
    { id: "feedScrollDown", label: "Scroll Feed down", section: "Player", ns: "single" },
  ];

  // Ships as first-install defaults: today's hardcoded keys.
  // Chord Bindings are sequences: {first, second}. first null = fires on a
  // single press of second. Seconds never steal native keys (they only apply
  // after the leader), so only firsts take part in duplicate checks.
  const LEAD = () => B("g");
  const DEFAULTS = {
    hintArm: B("Enter"),
    chordHome: { first: LEAD(), second: B("h") },
    chordSubs: { first: LEAD(), second: B("s") },
    chordTrending: { first: LEAD(), second: B("t") },
    chordHistory: { first: LEAD(), second: B("w") },
    chordLibrary: { first: LEAD(), second: B("l") },
    chordSearch: { first: LEAD(), second: B("/") },
    historyBack: B("p"),
    historyForward: B("L"),
    theater: B("t"),
    speedToggle: B("e"),
    nextInRail: B("n"),
    feedScrollUp: B("ArrowUp", { ctrl: true }),
    feedScrollDown: B("ArrowDown", { ctrl: true }),
  };

  // YouTube-native keys worth an inline warning when a Binding with no
  // modifiers claims them. https://support.google.com/youtube/answer/7631406
  const NATIVE_WARN = {
    f: "fullscreen",
    k: "play / pause",
    j: "back 10s",
    l: "forward 10s",
    m: "mute",
    c: "captions",
    i: "miniplayer",
    "/": "search",
    " ": "play / scroll",
    ArrowLeft: "back 5s",
    ArrowRight: "forward 5s",
    ArrowUp: "volume",
    ArrowDown: "volume",
    0: "seek 0%",
    1: "seek 10%",
    2: "seek 20%",
    3: "seek 30%",
    4: "seek 40%",
    5: "seek 50%",
    6: "seek 60%",
    7: "seek 70%",
    8: "seek 80%",
    9: "seek 90%",
  };

  const STORAGE_KEY = "keytube.bindings.v1";
  const EVENT_NAME = "keytube:bindings";

  function sameBinding(a, b) {
    if (!a || !b) return false;
    return (
      a.key === b.key &&
      !!a.ctrl === !!b.ctrl &&
      !!a.shift === !!b.shift &&
      !!a.alt === !!b.alt &&
      !!a.meta === !!b.meta
    );
  }

  function matchesEvent(e, b) {
    if (!b) return false;
    return (
      e.key === b.key &&
      e.ctrlKey === !!b.ctrl &&
      e.shiftKey === !!b.shift &&
      e.altKey === !!b.alt &&
      e.metaKey === !!b.meta
    );
  }

  function displayName(b) {
    if (!b) return "unassigned";
    const parts = [];
    if (b.ctrl) parts.push("Ctrl");
    if (b.alt) parts.push("Alt");
    if (b.shift) parts.push("Shift");
    if (b.meta) parts.push("Meta");
    let k = b.key;
    if (k === " ") k = "Space";
    else if (k === "ArrowUp") k = "↑";
    else if (k === "ArrowDown") k = "↓";
    else if (k === "ArrowLeft") k = "←";
    else if (k === "ArrowRight") k = "→";
    else if (k === "Escape") k = "Esc";
    parts.push(k.length === 1 ? k.toUpperCase() : k);
    return parts.join("+");
  }

  // Warns only when a bare key (no modifiers) claims a YouTube-native key.
  function nativeWarning(b) {
    if (!b || b.ctrl || b.alt || b.meta || b.shift) return null;
    const what = NATIVE_WARN[b.key];
    return what ? `overrides YouTube ${what}` : null;
  }

  // Row-level warning: single-press Actions warn on their Binding; Chord
  // Actions warn only on the leader (or the single key, when leaderless) —
  // seconds never fire outside a Chord, so they steal nothing.
  function rowWarning(action, b) {
    if (!b) return null;
    if (action.ns !== "chord") return nativeWarning(b);
    return nativeWarning(b.first || b.second);
  }

  function isKeyBinding(b) {
    return !!b && typeof b.key === "string";
  }

  function copyBinding(b) {
    return b ? { key: b.key, ctrl: !!b.ctrl, shift: !!b.shift, alt: !!b.alt, meta: !!b.meta } : null;
  }

  function sameSequence(a, b) {
    if (!a || !b) return false;
    const byId = (x, y) => (x == null && y == null) || sameBinding(x, y);
    return byId(a.first, b.first) && sameBinding(a.second, b.second);
  }

  function displaySequence(b) {
    if (!b) return "unassigned";
    if (!b.first) return `${displayName(b.second)} (single)`;
    return `${displayName(b.first)} → ${displayName(b.second)}`;
  }

  // Merge stored Bindings over defaults, dropping anything with the wrong
  // shape (e.g. maps stored before Chord sequences existed).
  function sanitizeBindings(stored) {
    const out = {};
    for (const a of ACTIONS) {
      out[a.id] = a.ns === "chord" ? { first: copyBinding(DEFAULTS[a.id].first), second: copyBinding(DEFAULTS[a.id].second) } : copyBinding(DEFAULTS[a.id]);
    }
    if (!stored || typeof stored !== "object") return out;
    for (const a of ACTIONS) {
      const v = stored[a.id];
      if (v == null) {
        out[a.id] = null;
      } else if (a.ns === "chord") {
        if (v && typeof v === "object" && (v.first == null || isKeyBinding(v.first)) && isKeyBinding(v.second)) {
          out[a.id] = { first: copyBinding(v.first), second: copyBinding(v.second) };
        }
      } else if (isKeyBinding(v)) {
        out[a.id] = copyBinding(v);
      }
    }
    return out;
  }

  globalThis.KEYTUBE = {
    ACTIONS,
    DEFAULTS,
    NATIVE_WARN,
    STORAGE_KEY,
    EVENT_NAME,
    sameBinding,
    sameSequence,
    matchesEvent,
    displayName,
    displaySequence,
    nativeWarning,
    rowWarning,
    sanitizeBindings,
    // Fixed keys: Esc exits, 1-9 select while armed. Never Actions.
    FIXED_NOTE: "Esc exits, 1–9 select while armed. Hint Mode badges the first 9 visible videos.",
  };
})();
