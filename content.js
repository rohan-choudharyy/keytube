// keytube content script — plain JS, no build, no deps.
// Glossary: Feed, Watch-next, Player, Hint Mode, Badge, Chord (see CONTEXT.md).
// Runs in MAIN world (see manifest.json "world": "MAIN") so capture-phase
// stopImmediatePropagation() beats YouTube's own handlers for keys we steal.
// Bindings arrive live from bridge.js via the "keytube:bindings" window event
// (MAIN world can't touch chrome.*). Falls back to shipped defaults.
// Uses zero chrome.* APIs, so MAIN world is safe.
(() => {
  const SELECTORS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    // Modern YouTube (2025+): home + Watch-next render as lockups, old
    // ytd-*-renderer nodes disappear on the watch page.
    "yt-lockup-view-model",
  ].join(", ");
  const PAGE_SIZE = 9;
  const CHORD_TIMEOUT = 1500;
  // Chord destinations: leader then second selects (g then h = home, etc.).
  // Second-press Bindings live in the "chord" namespace; single-press
  // Bindings live in "single". Sharing across namespaces is intentional
  // (t = theater and Chord trending); uniqueness is enforced per namespace.
  const CHORD_PATHS = {
    chordHome: "/",
    chordSubs: "/feed/subscriptions",
    chordTrending: "/feed/trending",
    chordHistory: "/feed/history",
    chordLibrary: "/feed/library",
  };
  const CHORD_IDS = ["chordHome", "chordSubs", "chordTrending", "chordHistory", "chordLibrary", "chordSearch"];

  // Live Bindings by Action id. Start from shipped defaults so keys work
  // before the isolated bridge delivers stored Bindings; updated live via
  // the "keytube:bindings" window event (MAIN world can't touch chrome.*).
  const KT = globalThis.KEYTUBE || {};
  let B = KT.sanitizeBindings ? KT.sanitizeBindings(null) : { ...(KT.DEFAULTS || {}) };
  const isBinding = (e, id) => (KT.matchesEvent ? KT.matchesEvent(e, B[id]) : false);
  const bindingName = (id) => (KT.displayName ? KT.displayName(B[id]) : String((B[id] || {}).key || "?"));
  window.addEventListener(KT.EVENT_NAME || "keytube:bindings", (ev) => {
    if (ev && ev.detail && KT.sanitizeBindings) B = KT.sanitizeBindings(ev.detail);
  });
  let armed = false;
  let items = []; // visible elements Badged right now (max PAGE_SIZE)
  let chord = null; // pending Chord leaders: {first, ids} awaiting a second press
  let box = null;
  let pill = null;

  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("#movie_player video");
  const typing = () => {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  };

  function ensureUI() {
    if (!box || !box.isConnected) {
      box = document.createElement("div");
      box.id = "keytube-badges";
      box.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none;contain:layout paint;";
      document.documentElement.appendChild(box);
    }
    if (!pill || !pill.isConnected) {
      pill = document.createElement("div");
      pill.id = "keytube-pill";
      pill.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:100000;background:#000;color:#fff;font:12px/1.4 system-ui;padding:4px 10px;border-radius:999px;display:none;pointer-events:none;";
      document.documentElement.appendChild(pill);
    }
  }

  function showPill(text, ms = 1500) {
    ensureUI();
    pill.textContent = text;
    pill.style.display = "block";
    clearTimeout(showPill.t);
    if (ms) showPill.t = setTimeout(() => (pill.style.display = "none"), ms);
  }

  function visibleItems() {
    // ponytail: query-on-arm, no MutationObserver pre-index; rescan if Feed paginates mid-Hint-Mode.
    // Partially visible rows count (bottom > 0, not top >= 0) so a half-scrolled
    // Watch-next rail on the watch page still yields Badges. Dedupes nested
    // matches (e.g. a lockup inside a ytd- renderer) via outermost-only.
    const seen = new Set();
    return [...document.querySelectorAll(SELECTORS)].filter((el) => {
      if (el.offsetParent === null && el.getClientRects().length === 0) return false;
      // Skip nested matches: only the outermost selectable keeps a Badge.
      if (el.parentElement && el.parentElement.closest(SELECTORS)) return false;
      if (!linkFor(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (r.bottom <= 0 || r.top >= innerHeight) return false;
      if (seen.has(r.top + ":" + r.left)) return false;
      seen.add(r.top + ":" + r.left);
      return true;
    });
  }

  function linkFor(el) {
    if (!el || !el.querySelector) return null;
    return (
      el.querySelector("a#thumbnail[href]") ||
      el.querySelector("a#video-title[href]") ||
      el.querySelector('a[href*="/watch"]') ||
      el.querySelector('a[href*="/shorts"]') ||
      el.querySelector('a[href*="/playlist"]') ||
      el.querySelector("a.yt-simple-endpoint[href]") ||
      el.querySelector("a[href]")
    );
  }

  function pillText() {
    return `keytube: HINTS 1–${items.length} — 1–9 selects, ${bindingName("hintArm")}/Esc exits`;
  }

  function renderBadges() {
    box.replaceChildren(); // not innerHTML: YouTube enforces Trusted Types
    items.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const b = document.createElement("div");
      b.textContent = String(i + 1);
      b.style.cssText = `position:fixed;left:${r.left + 6}px;top:${r.top + 6}px;min-width:22px;height:22px;background:#f00;color:#fff;font:bold 13px/22px system-ui;text-align:center;border-radius:6px;box-shadow:0 1px 4px #0008;`;
      box.appendChild(b);
    });
    showPill(pillText(), 0);
  }

  function rescan(retry = true) {
    // ponytail: query-on-arm, no MutationObserver pre-index; Badges track the viewport
    items = visibleItems().slice(0, PAGE_SIZE);
    if (!items.length) {
      // Watch page lazy-renders the Watch-next rail after nav: one retry.
      if (retry) {
        setTimeout(() => {
          if (!armed) return;
          items = visibleItems().slice(0, PAGE_SIZE);
          if (!items.length) {
            showPill("keytube: no videos found — layout changed?", 2500);
            armed = false;
            return;
          }
          renderBadges();
        }, 600);
        showPill("keytube: waiting for videos…", 600);
        return;
      }
      showPill("keytube: no videos found — layout changed?", 2500);
      armed = false;
      return;
    }
    renderBadges();
  }

  function openLink(link) {
    if (!link || !link.href) return false;
    const before = location.href;
    const href = link.href;
    console.log("[keytube] opening", href);
    link.click();
    // Fallback: if the SPA router ignored the synthetic click, do a full nav.
    setTimeout(() => {
      if (location.href === before) location.assign(href);
    }, 350);
    return true;
  }

  function arm() {
    ensureUI();
    armed = true;
    rescan(); // clears armed when the Feed has no visible videos
  }

  function disarm() {
    armed = false;
    items = [];
    if (box) box.replaceChildren();
    if (pill) pill.style.display = "none";
  }

  function theater() {
    const v = video();
    const btn =
      document.querySelector("#movie_player .ytp-size-button") ||
      document.querySelector('#movie_player button[aria-label*="heater" i]');
    if (btn) btn.click();
    else if (v && document.pictureInPictureElement) document.exitPictureInPicture();
  }

  function nextInRail() {
    openLink(linkFor(visibleItems()[0]));
  }

  // Media keys (receive-only while this tab is the active session).
  try {
    const ms = navigator.mediaSession;
    if (ms) {
      ms.setActionHandler("play", () => video()?.play());
      ms.setActionHandler("pause", () => video()?.pause());
      ms.setActionHandler("nexttrack", nextInRail);
      ms.setActionHandler("previoustrack", () => history.back());
    }
  } catch {}

  function cancelChord() {
    chord = null;
    clearTimeout(cancelChord.t);
    if (pill && !armed) pill.style.display = "none";
  }

  function armChord(ids) {
    const first = B[ids[0]].first;
    chord = { first, ids };
    clearTimeout(cancelChord.t);
    cancelChord.t = setTimeout(cancelChord, CHORD_TIMEOUT);
    const shorts = { chordHome: "home", chordSubs: "subs", chordTrending: "trending", chordHistory: "history", chordLibrary: "library", chordSearch: "search" };
    const secondName = (id) => (KT.displayName ? KT.displayName(B[id].second) : String(B[id].second.key));
    const parts = ids.map((id) => `${secondName(id)} ${shorts[id]}`).join(", ");
    showPill(`keytube: ${KT.displayName(first)}… (${parts})`, 0);
  }

  function runChord(id) {
    cancelChord();
    if (id === "chordSearch") {
      // search Chord: focus YouTube search, same target as native `/`
      const q = document.querySelector("input#search") || document.querySelector('input[name="search_query"]');
      if (q) q.focus();
      return true;
    }
    const dest = CHORD_PATHS[id];
    if (dest) location.assign(dest);
    return !!dest;
  }

  // Bare Enter/Space activate focused links and buttons natively; a Binding
  // for those keys must not steal that activation.
  function focusKeepsKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key !== "Enter" && e.key !== " ") return false;
    const ae = document.activeElement;
    return !!ae && /^(A|BUTTON|SELECT)$/.test(ae.tagName);
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.isTrusted || e.isComposing) return;
      const k = e.key;
      const mods = e.ctrlKey || e.metaKey || e.altKey;

      // Feed scroll Actions: may carry modifiers, work armed or not, hold-to-repeat.
      // Badges rescan via the scroll listener, so Hint Mode stays armed.
      if (isBinding(e, "feedScrollUp") || isBinding(e, "feedScrollDown")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const delta = Math.round(innerHeight * 0.7) * (isBinding(e, "feedScrollUp") ? -1 : 1);
        window.scrollBy({ top: delta, behavior: e.repeat ? "auto" : "smooth" });
        return;
      }

      if (armed) {
        if (k === "Escape" && !mods) {
          e.preventDefault();
          e.stopImmediatePropagation();
          disarm();
        } else if (!mods && k >= "1" && k <= "9") {
          // Fixed selection keys; modified digits (Ctrl+1 tab switch…) pass through.
          e.preventDefault();
          e.stopImmediatePropagation();
          const target = items[Number(k) - 1];
          if (!target) return; // out of range: stay armed
          const ok = openLink(linkFor(target));
          disarm();
          if (!ok) {
            console.warn("[keytube] no link found on item", Number(k));
            showPill("keytube: no link on that video", 2000);
          }
        } else if (!mods && k === " ") {
          // No paging: Space must not scroll the Feed while armed.
          e.preventDefault();
          e.stopImmediatePropagation();
        } else if (isBinding(e, "hintArm")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          disarm(); // toggle off
        } else if (mods) {
          return; // browser shortcuts (close tab, tab switch…) pass through untouched
        } else {
          // Swallow other bare keys while armed: no seek/fullscreen mid-selection.
          e.stopImmediatePropagation();
        }
        return;
      }

      if (typing()) {
        if (k === "Escape") document.activeElement.blur();
        return;
      }
      if (e.repeat) return;

      // Chord: a matched leader arms its destinations; the next press completes.
      if (chord) {
        if (k === "Escape" && !mods) {
          e.preventDefault();
          cancelChord();
          return;
        }
        const hit = chord.ids.find((id) => B[id] && B[id].second && KT.matchesEvent(e, B[id].second));
        if (hit) {
          e.preventDefault();
          e.stopImmediatePropagation();
          runChord(hit);
          return;
        }
        cancelChord(); // unknown second key: fall through, handle k normally
      }

      // Leaders take precedence over single-press Actions on this keystroke.
      const leaders = CHORD_IDS.filter((id) => B[id] && B[id].first && KT.matchesEvent(e, B[id].first));
      if (leaders.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        armChord(leaders);
      } else if (isBinding(e, "hintArm")) {
        // Hint Mode arm; native `f` fullscreen is left untouched.
        if (focusKeepsKey(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        arm();
      } else if (k === "Escape" && !mods) {
        cancelChord();
        disarm();
      } else if (isBinding(e, "theater")) {
        if (focusKeepsKey(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        theater();
      } else if (isBinding(e, "speedToggle")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const v = video();
        if (v) v.playbackRate = v.playbackRate === 2 ? 1 : 2;
      } else if (isBinding(e, "nextInRail")) {
        if (focusKeepsKey(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        nextInRail();
      } else if (isBinding(e, "historyBack") || (!mods && k === "H" && B.historyBack)) {
        // H mirrors Vimium; active only while the Action itself is assigned.
        e.preventDefault();
        e.stopImmediatePropagation();
        history.back();
      } else if (isBinding(e, "historyForward")) {
        // Lowercase l stays native (+10s seek) unless remapped onto it.
        e.preventDefault();
        e.stopImmediatePropagation();
        history.forward();
      } else {
        // Leaderless Chords (no first): the second fires on a single press.
        const solo = CHORD_IDS.find((id) => B[id] && !B[id].first && B[id].second && KT.matchesEvent(e, B[id].second));
        if (solo) {
          if (focusKeepsKey(e)) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          runChord(solo);
        }
      }
      // Everything else (f/F fullscreen, k/j/l/m/c/i, arrows, Shift+N/P, /, 0-9 seek): native YouTube.
    },
    true
  );

  let scrollQueued = false;
  function queueRescan() {
    // Throttle: one rescan per frame while scrolling, so Badges track the viewport.
    // Empty viewport (e.g. scrolled to comments) keeps old Badges instead of disarming.
    if (!armed || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      if (!armed) return;
      const found = visibleItems().slice(0, PAGE_SIZE);
      if (!found.length) return;
      items = found;
      renderBadges();
    });
  }
  // capture=true: Watch-next rail can scroll in a nested container, not window.
  addEventListener("scroll", queueRescan, { passive: true, capture: true });
  addEventListener("resize", queueRescan, { passive: true });
  // YouTube SPA nav keeps the document alive: drop stale Badges on page change.
  document.addEventListener("yt-navigate-finish", () => disarm(), true);
})();
