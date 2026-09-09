// keytube content script — plain JS, no build, no deps.
// Glossary: Feed, Watch-next, Player, Hint Mode, Badge (see CONTEXT.md).
// Runs in MAIN world (see manifest.json "world": "MAIN") so capture-phase
// stopImmediatePropagation() beats YouTube's own `f` fullscreen handler.
// Uses zero chrome.* APIs, so MAIN world is safe.
(() => {
  const SELECTORS = "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-panel-video-renderer";
  let armed = false;
  let items = [];
  let box = null;
  let pill = null;

  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("#movie_player video");
  const typing = () => {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  };

  function ensureUI() {
    if (!box) {
      box = document.createElement("div");
      box.id = "keytube-badges";
      box.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none;contain:layout paint;";
      document.documentElement.appendChild(box);
    }
    if (!pill) {
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
    // ponytail: query-on-arm, no MutationObserver pre-index; rescan if Feed paginates mid-Hint-Mode
    return [...document.querySelectorAll(SELECTORS)].filter((el) => {
      if (el.offsetParent === null) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    });
  }

  function linkFor(el) {
    if (!el || !el.querySelector) return null;
    return (
      el.querySelector("a#thumbnail") ||
      el.querySelector("a#video-title") ||
      el.querySelector('a[href*="/watch"], a[href*="/shorts"]') ||
      el.querySelector("a.yt-simple-endpoint")
    );
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
    items = visibleItems().slice(0, 9);
    box.replaceChildren(); // not innerHTML: YouTube enforces Trusted Types
    if (!items.length) {
      showPill("keytube: no videos found — layout changed?", 2500);
      armed = false;
      return;
    }
    items.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const b = document.createElement("div");
      b.textContent = String(i + 1);
      b.style.cssText = `position:fixed;left:${r.left + 6}px;top:${r.top + 6}px;min-width:22px;height:22px;background:#f00;color:#fff;font:bold 13px/22px system-ui;text-align:center;border-radius:6px;box-shadow:0 1px 4px #0008;`;
      box.appendChild(b);
    });
    armed = true;
    showPill(`keytube: HINTS 1–${items.length} (Esc exits)`, 0);
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

  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.isTrusted || e.isComposing) return;
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
        } else if (k === "f") {
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

      if (k === "f") {
        // Steals native fullscreen; Shift+F falls through to native.
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        arm();
      } else if (k === "F") {
        const v = video();
        if (v && document.fullscreenElement) document.exitFullscreen();
        else if (v) (document.querySelector("#movie_player") || v).requestFullscreen?.();
      } else if (k === "Escape") {
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
      } else if (k === "p") {
        e.preventDefault();
        history.back();
      }
      // Everything else (k/j/l/m/c/i, arrows, Shift+N/P, /, 0-9 seek): native YouTube.
    },
    true
  );

  addEventListener("scroll", () => armed && arm(), { passive: true });
})();
