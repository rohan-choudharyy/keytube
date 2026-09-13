// keytube bridge — isolated-world content script, plain JS, no build.
// The MAIN-world content.js can't touch chrome.* APIs, so this script owns
// storage and relays Bindings to the page via a window CustomEvent.
// With storage.onChanged the relay is live: popup saves apply instantly to
// already-open YouTube tabs, no reload needed.
(() => {
  const KT = globalThis.KEYTUBE || {};
  const KEY = KT.STORAGE_KEY || "keytube.bindings.v1";
  const EVENT = KT.EVENT_NAME || "keytube:bindings";
  const DEFAULTS = KT.DEFAULTS || {};

  // Merge stored Bindings over defaults so new Actions in later versions
  // get a Binding even if the user stored an older map; wrong-shaped stored
  // values (e.g. pre-sequence Chords) fall back to defaults.
  function pushStored(stored) {
    const merged = KT.sanitizeBindings ? KT.sanitizeBindings(stored) : { ...DEFAULTS, ...(stored || {}) };
    window.dispatchEvent(new CustomEvent(EVENT, { detail: merged }));
  }

  try {
    const area = chrome.storage.sync || chrome.storage.local;
    area.get({ [KEY]: null }, (res) => {
      if (chrome.runtime.lastError) {
        pushStored(null);
        return;
      }
      pushStored(res[KEY]);
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") return;
      const c = changes[KEY];
      if (c) pushStored(c.newValue);
    });
  } catch {
    pushStored(null); // storage unavailable (shouldn't happen): defaults rule
  }
})();
