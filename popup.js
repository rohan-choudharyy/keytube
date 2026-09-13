// keytube popup — plain JS, no build. Grouped Binding recorder.
// Singles: click a chip → press the combo → recorded instantly; same combo
// again clears to unassigned. Chords: click → press leader → press second
// (or "single key" for a one-press Chord); same sequence again clears.
// A combo already live elsewhere is rejected with "already used by X".
// Saves go to chrome.storage; bridge.js relays them live to open tabs.
(() => {
  const KT = globalThis.KEYTUBE || {};
  const ACTIONS = KT.ACTIONS || [];
  const DEFAULTS = KT.DEFAULTS || {};
  const KEY = KT.STORAGE_KEY || "keytube.bindings.v1";

  let bindings = KT.sanitizeBindings ? KT.sanitizeBindings(null) : { ...DEFAULTS };
  let recording = null; // {id, step, first} — step 1 leader, step 2 second
  let flash = null; // {id, text} transient duplicate message

  const groups = document.getElementById("groups");
  document.getElementById("fixed-note").textContent = KT.FIXED_NOTE || "";
  const summary = document.getElementById("summary");
  if (summary) {
    summary.replaceChildren(`${ACTIONS.length} bindings live on every YouTube page.`);
  }
  const keyCount = document.getElementById("key-count");
  if (keyCount) keyCount.textContent = `${ACTIONS.length} keys`;
  const hintChange = document.getElementById("hint-change");
  if (hintChange) {
    hintChange.addEventListener("click", () => {
      const chip = groups.querySelector('[data-id="hintArm"] kbd');
      if (chip) {
        chip.click();
        chip.focus();
      }
    });
  }

  function actionLabel(id) {
    return (ACTIONS.find((a) => a.id === id) || {}).label || id;
  }

  function copyDefault(id) {
    const d = DEFAULTS[id];
    const a = ACTIONS.find((x) => x.id === id);
    if (d == null) return null;
    if (a && a.ns === "chord") return { first: d.first && { ...d.first }, second: { ...d.second } };
    return { ...d };
  }

  // A single-press key is dead if a Chord leader claims it (leaders win), so
  // singles clash with other singles, leaderless Chord singles, and leaders.
  function singleClash(id, b) {
    return (
      ACTIONS.find(
        (a) =>
          a.id !== id &&
          (a.ns === "single"
            ? KT.sameBinding(bindings[a.id], b)
            : bindings[a.id] && !bindings[a.id].first && KT.sameBinding(bindings[a.id].second, b))
      ) ||
      ACTIONS.find((a) => a.ns === "chord" && bindings[a.id] && bindings[a.id].first && KT.sameBinding(bindings[a.id].first, b)) ||
      null
    );
  }

  // A leader must not kill a live single-press key; shared leaders are fine.
  function chordFirstClash(id, f) {
    return (
      ACTIONS.find(
        (a) =>
          a.id !== id &&
          (a.ns === "single"
            ? KT.sameBinding(bindings[a.id], f)
            : bindings[a.id] && !bindings[a.id].first && KT.sameBinding(bindings[a.id].second, f))
      ) || null
    );
  }

  function chordPairClash(id, seq) {
    return ACTIONS.find((a) => a.id !== id && a.ns === "chord" && KT.sameSequence(bindings[a.id], seq)) || null;
  }

  function save() {
    try {
      chrome.storage.sync.set({ [KEY]: bindings });
    } catch {}
  }

  function chipText(a, b) {
    if (recording && recording.id === a.id) {
      if (a.ns !== "chord") return "press keys…";
      return recording.step === 1 ? "press leader…" : "press second…";
    }
    return a.ns === "chord" ? KT.displaySequence(b) : KT.displayName(b);
  }

  function hintText(a) {
    if (a.ns !== "chord") return "Press a combo, or the same combo to clear. Esc cancels.";
    if (recording.step === 1) return "Press the leader combo, or go single-key below. Esc cancels.";
    return "Press the second combo. Same sequence again clears. Esc cancels.";
  }

  function render() {
    groups.replaceChildren();
    let section = null;
    let box = null;
    for (const a of ACTIONS) {
      if (a.section !== section) {
        section = a.section;
        const h = document.createElement("section");
        h.appendChild(Object.assign(document.createElement("h2"), { textContent: section }));
        box = document.createElement("div");
        h.appendChild(box);
        groups.appendChild(h);
      }
      const b = bindings[a.id] || null;
      const isRec = recording && recording.id === a.id;
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.ns = a.ns;
      row.dataset.id = a.id;
      const top = document.createElement("div");
      top.className = "row-top";
      const label = document.createElement("label");
      label.textContent = a.label;
      const chip = document.createElement("kbd");
      chip.textContent = chipText(a, b);
      chip.classList.toggle("recording", isRec);
      chip.classList.toggle("empty", !b && !isRec);
      chip.title = a.ns === "chord" ? "Click, then press leader + second. Same sequence again clears." : "Click, then press a key combo. Same combo again clears.";
      chip.addEventListener("click", () => {
        recording = isRec ? null : { id: a.id, step: 1, first: null };
        flash = null;
        chip.blur();
        render();
      });
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "mini";
      reset.textContent = "⟲";
      reset.title = `Reset "${a.label}" to default (${a.ns === "chord" ? KT.displaySequence(DEFAULTS[a.id]) : KT.displayName(DEFAULTS[a.id])})`;
      reset.addEventListener("click", () => {
        bindings[a.id] = copyDefault(a.id);
        if (isRec) recording = null;
        flash = null;
        save();
        render();
      });
      top.append(label, chip, reset);
      row.appendChild(top);
      const warn = b ? KT.rowWarning(a, b) : null;
      if (warn) {
        const p = document.createElement("p");
        p.className = "warn";
        p.textContent = `⚠ ${warn}`;
        row.appendChild(p);
      }
      if (flash && flash.id === a.id) {
        const p = document.createElement("p");
        p.className = "error";
        p.textContent = flash.text;
        row.appendChild(p);
      } else if (isRec) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = hintText(a);
        row.appendChild(p);
        if (a.ns === "chord" && recording.step === 1) {
          const skip = document.createElement("button");
          skip.type = "button";
          skip.className = "mini link";
          skip.textContent = "single key instead (no leader)";
          skip.addEventListener("click", () => {
            recording.first = null;
            recording.step = 2;
            render();
          });
          row.appendChild(skip);
        }
      }
      box.appendChild(row);
    }
    refreshHintPill();
  }

  // Hero pill bar mirrors the live Hint Mode Binding; the dot pulses
  // while its chip is recording.
  function refreshHintPill() {
    const hint = ACTIONS.find((x) => x.id === "hintArm");
    const text = document.getElementById("hint-text");
    if (text && hint) {
      const b = bindings.hintArm;
      text.replaceChildren(
        "Hint Mode on ",
        Object.assign(document.createElement("b"), {
          textContent: b ? KT.displayName(b) : "unassigned",
        })
      );
    }
    const dot = document.getElementById("hint-dot");
    if (dot) dot.classList.toggle("busy", !!recording && recording.id === "hintArm");
  }

  function reject(id, other, what) {
    flash = { id, text: `already used by “${actionLabel(other.id)}”${what} — press another combo or Esc` };
    render();
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      const a = ACTIONS.find((x) => x.id === recording.id);
      if (!a) {
        recording = null;
        render();
        return;
      }
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        recording = null; // Esc cancels recording; Esc itself is never a Binding
        flash = null;
        render();
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // pure modifier: keep waiting
      const pressed = { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };

      if (a.ns !== "chord") {
        if (KT.sameBinding(bindings[a.id], pressed)) {
          bindings[a.id] = null; // same combo again → unassigned (falls back to native)
          recording = null;
          flash = null;
        } else {
          const taken = singleClash(a.id, pressed);
          if (taken) {
            reject(a.id, taken, "");
            return; // stay recording
          }
          bindings[a.id] = pressed;
          recording = null;
          flash = null;
        }
        save();
        render();
        return;
      }

      if (recording.step === 1) {
        recording.first = pressed;
        recording.step = 2;
        flash = null;
        render();
        return;
      }
      const seq = { first: recording.first, second: pressed };
      if (KT.sameSequence(bindings[a.id], seq)) {
        bindings[a.id] = null; // same sequence again → unassigned
        recording = null;
        flash = null;
      } else if (!seq.first) {
        const taken = singleClash(a.id, seq.second);
        if (taken) {
          reject(a.id, taken, "");
          return;
        }
        bindings[a.id] = seq;
        recording = null;
        flash = null;
      } else {
        const pairTaken = chordPairClash(a.id, seq);
        if (pairTaken) {
          reject(a.id, pairTaken, " (same sequence)");
          return;
        }
        const firstTaken = chordFirstClash(a.id, seq.first);
        if (firstTaken) {
          reject(a.id, firstTaken, " (leader)");
          return;
        }
        bindings[a.id] = seq;
        recording = null;
        flash = null;
      }
      save();
      render();
    },
    true
  );

  document.getElementById("reset-all").addEventListener("click", () => {
    bindings = KT.sanitizeBindings(null);
    recording = null;
    flash = null;
    save();
    render();
  });

  // First-install Tour: slideshow overlay inside the popup, shown once.
  // No replay UI: the seen flag in chrome.storage.local makes it once-only.
  // Closing the popup mid-Tour leaves the flag unset, so the Tour resumes
  // on next open — it only disappears after Skip / Done.
  const TOUR_KEY = "keytube.tourSeen.v1";
  const KOFI_URL = "https://ko-fi.com/rohvnwho/goal?g=12";
  const tourEl = document.getElementById("tour");
  const tourTitle = document.getElementById("tour-title");
  const tourBody = document.getElementById("tour-body");
  const tourKofi = document.getElementById("tour-kofi");
  const tourDots = document.getElementById("tour-dots");
  const tourBack = document.getElementById("tour-back");
  const tourNext = document.getElementById("tour-next");
  const tourSkip = document.getElementById("tour-skip");
  let tourIndex = 0;

  // Support Card + Tour CTA open the Ko-fi Support link in a new tab.
  // Plain hrefs don't reliably open from a popup, so route through tabs.
  function openKofi() {
    try {
      if (chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: KOFI_URL });
      else globalThis.open(KOFI_URL, "_blank", "noopener");
    } catch {
      globalThis.open(KOFI_URL, "_blank", "noopener");
    }
  }

  document.getElementById("support-kofi").addEventListener("click", openKofi);
  if (tourKofi) tourKofi.addEventListener("click", (e) => {
    e.preventDefault();
    openKofi();
  });

  function tourName(id) {
    const b = bindings[id] || DEFAULTS[id];
    if (!b) return "?";
    const a = ACTIONS.find((x) => x.id === id);
    return a && a.ns === "chord" ? KT.displaySequence(b) : KT.displayName(b);
  }

  function tourSlides() {
    const chordList = ACTIONS.filter((a) => a.ns === "chord")
      .map((a) => `${tourName(a.id)}`)
      .join(", ");
    return [
      { title: "1/6 · Pick videos with Hint Mode", parts: ["Press ", ["kbd", tourName("hintArm")], " on any Feed or Watch-next. Numbered Badges (1–9) appear — press a digit to open, ", ["kbd", tourName("hintArm")], " or Esc to exit."] },
      { title: "2/6 · Jump with Chords", parts: ["Press the leader, then a second key: ", chordList, ". The second key only counts after the leader, so normal typing is safe."] },
      { title: "3/6 · Drive the Player", parts: ["Theater (", ["kbd", tourName("theater")], "), 2x speed (", ["kbd", tourName("speedToggle")], "), first Watch-next video (", ["kbd", tourName("nextInRail")], "). Play, seek, volume stay native YouTube."] },
      { title: "4/6 · Scroll and travel", parts: ["Feed scroll: ", ["kbd", tourName("feedScrollUp")], " / ", ["kbd", tourName("feedScrollDown")], " (works while armed). History: ", ["kbd", tourName("historyBack")], " back, ", ["kbd", tourName("historyForward")], " forward."] },
      { title: "5/6 · What you can change", parts: ["Every chip below is a remappable Action — click it, press your combo. Fixed forever: Esc exits, 1–9 select while armed, plus native YouTube keys unless you override one (we warn you)."] },
      { title: "6/6 · Support keytube", parts: ["keytube is free with no backend or login — if it saves you time, chip in on Ko-fi. It keeps development going."] },
    ];
  }

  function renderTour() {
    const slides = tourSlides();
    tourIndex = Math.max(0, Math.min(tourIndex, slides.length - 1));
    const s = slides[tourIndex];
    tourTitle.replaceChildren(s.title);
    tourBody.replaceChildren(
      ...s.parts.map((p) => (typeof p === "string" ? p : Object.assign(document.createElement(p[0]), { textContent: p[1] })))
    );
    if (tourKofi) tourKofi.hidden = tourIndex !== slides.length - 1;
    tourDots.replaceChildren();
    slides.forEach((_, i) => {
      const d = document.createElement("span");
      if (i === tourIndex) d.className = "on";
      tourDots.appendChild(d);
    });
    tourBack.disabled = tourIndex === 0;
    tourBack.style.opacity = tourIndex === 0 ? "0.4" : "1";
    tourNext.replaceChildren(tourIndex === slides.length - 1 ? "Done ✓" : "Next →");
  }

  function showTour() {
    tourIndex = 0;
    renderTour();
    tourEl.hidden = false;
    tourNext.focus();
  }

  function finishTour() {
    try {
      (chrome.storage.local || chrome.storage.sync).set({ [TOUR_KEY]: true });
    } catch {}
    tourEl.hidden = true;
  }

  tourBack.addEventListener("click", () => {
    tourIndex -= 1;
    renderTour();
  });
  tourNext.addEventListener("click", () => {
    if (tourIndex >= tourSlides().length - 1) finishTour();
    else {
      tourIndex += 1;
      renderTour();
    }
  });
  tourSkip.addEventListener("click", finishTour);

  try {
    (chrome.storage.local || chrome.storage.sync).get({ [TOUR_KEY]: false }, (res) => {
      const err = chrome.runtime.lastError;
      if (!err && !(res && res[TOUR_KEY])) showTour();
    });
  } catch {}

  try {
    chrome.storage.sync.get({ [KEY]: null }, (res) => {
      const err = chrome.runtime.lastError;
      if (!err && res[KEY]) bindings = KT.sanitizeBindings(res[KEY]);
      render();
    });
  } catch {
    render();
  }
  render(); // instant paint with defaults; storage merge re-renders
})();
