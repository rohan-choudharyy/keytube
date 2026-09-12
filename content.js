// keytube content script — plain JS, no build, no deps.
// Glossary: Feed, Watch-next, Player, Hint Mode, Badge, Chord, Page (see CONTEXT.md).
// Runs in MAIN world (see manifest.json "world": "MAIN") so capture-phase
// stopImmediatePropagation() beats YouTube's own handlers for keys we steal.
// Hint Mode is armed with Enter, so native `f` fullscreen is left untouched.
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
  // Chord destinations: first key arms, second selects (g then h = home, etc.).
  const CHORDS = {
    h: "/",
    s: "/feed/subscriptions",
    t: "/feed/trending",
    w: "/feed/history",
    l: "/feed/library",
  };
  let armed = false;
  let items = []; // current Page of elements (max PAGE_SIZE)
  let allItems = []; // every visible element in the viewport
  let page = 0;
  let chord = null; // pending Chord first key, e.g. "g"
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

  function pageCount() {
    return Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  }

  function pillText() {
    const total = allItems.length;
    const pages = pageCount();
    return `keytube: HINTS ${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total} (Page ${page + 1}/${pages}) — [ ] pages, Enter/Esc exits`;
  }

  function renderPage() {
    page = Math.min(Math.max(0, page), pageCount() - 1);
    items = allItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
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
    allItems = visibleItems();
    if (!allItems.length) {
      // Watch page lazy-renders the Watch-next rail after nav: one retry.
      if (retry) {
        setTimeout(() => {
          if (!armed) return;
          allItems = visibleItems();
          if (!allItems.length) {
            showPill("keytube: no videos found — layout changed?", 2500);
            armed = false;
            return;
          }
          page = 0;
          renderPage();
        }, 600);
        showPill("keytube: waiting for videos…", 600);
        return;
      }
      showPill("keytube: no videos found — layout changed?", 2500);
      armed = false;
      return;
    }
    page = 0; // viewport content changed: restart from Page 1
    renderPage();
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
    page = 0;
    armed = true;
    rescan(); // clears armed when the Feed has no visible videos
  }

  function disarm() {
    armed = false;
    items = [];
    allItems = [];
    page = 0;
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

  function armChord(first) {
    chord = first;
    clearTimeout(cancelChord.t);
    cancelChord.t = setTimeout(cancelChord, CHORD_TIMEOUT);
    showPill("keytube: g… (h home, s subs, t trending, w history, l library, / search)", 0);
  }

  function runChord(second) {
    cancelChord();
    if (second === "/") {
      // search Chord: focus YouTube search, same target as native `/`
      const q = document.querySelector("input#search") || document.querySelector('input[name="search_query"]');
      if (q) q.focus();
      return true;
    }
    const dest = CHORDS[second.toLowerCase()];
    if (dest) location.assign(dest);
    return !!dest;
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.isTrusted || e.isComposing) return;
      // Feed scroll: Ctrl+Up / Ctrl+Down scrolls the viewport ~70%, stays armed
      // so Badges rescan via the scroll listener. Allows hold-to-repeat.
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const delta = Math.round(innerHeight * 0.7) * (e.key === "ArrowUp" ? -1 : 1);
        window.scrollBy({ top: delta, behavior: e.repeat ? "auto" : "smooth" });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;

      if (armed) {
        e.stopImmediatePropagation();
        if (k === "Escape") {
          e.preventDefault();
          disarm();
        } else if (k >= "1" && k <= "9") {
          e.preventDefault();
          const target = items[Number(k) - 1];
          if (!target) return; // out of range: stay armed
          const ok = openLink(linkFor(target));
          disarm();
          if (!ok) {
            console.warn("[keytube] no link found on item", Number(k));
            showPill("keytube: no link on that video", 2000);
          }
        } else if (k === "[") {
          e.preventDefault();
          page = (page + pageCount() - 1) % pageCount();
          renderPage();
        } else if (k === "]" || k === " ") {
          // next Page; Space must not scroll the Feed
          e.preventDefault();
          page = (page + 1) % pageCount();
          renderPage();
        } else if (k === "Enter") {
          e.preventDefault();
          disarm(); // toggle off
        }
        return;
      }

      if (typing()) {
        if (k === "Escape") document.activeElement.blur();
        return;
      }
      if (e.repeat) return;

      // Chord: a pending first key (e.g. g) claims this keystroke.
      if (chord) {
        if (k === "Escape") {
          e.preventDefault();
          cancelChord();
          return;
        }
        if (k === "/" || CHORDS[k.toLowerCase()] !== undefined) {
          e.preventDefault();
          e.stopImmediatePropagation();
          runChord(k);
          return;
        }
        cancelChord(); // unknown second key: fall through, handle k normally
      }

      if (k === "g") {
        e.preventDefault();
        e.stopImmediatePropagation();
        armChord("g");
      } else if (k === "Enter") {
        // Hint Mode arm; native `f` fullscreen is left untouched.
        // Let focused links/buttons keep native Enter activation.
        const ae = document.activeElement;
        if (ae && /^(A|BUTTON|SELECT)$/.test(ae.tagName)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        arm();
      } else if (k === "Escape") {
        cancelChord();
        disarm();
      } else if (k === "t") {
        e.preventDefault();
        theater();
      } else if (k === "e") {
        const v = video();
        if (v) v.playbackRate = v.playbackRate === 2 ? 1 : 2;
      } else if (k === "n") {
        e.preventDefault();
        nextInRail();
      } else if (k === "p" || k === "H") {
        // history back; H mirrors Vimium, p is the legacy alias
        e.preventDefault();
        history.back();
      } else if (k === "L") {
        // history forward; lowercase l stays native (+10s seek)
        e.preventDefault();
        history.forward();
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
      const found = visibleItems();
      if (!found.length) return;
      allItems = found;
      page = 0;
      renderPage();
    });
  }
  // capture=true: Watch-next rail can scroll in a nested container, not window.
  addEventListener("scroll", queueRescan, { passive: true, capture: true });
  addEventListener("resize", queueRescan, { passive: true });
  // YouTube SPA nav keeps the document alive: drop stale Badges on page change.
  document.addEventListener("yt-navigate-finish", () => disarm(), true);
})();
