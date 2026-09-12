# MV3 extension with in-page content script, augment native keys

We ship keytube as a Chrome+Edge MV3 extension with all hot-path logic in a YouTube content script, deferring to YouTube native keys and only adding missing behavior, with Hint Mode winning over seek when armed.

## Considered Options

- Userscript manager: same hot path but install friction and no store auto-update.
- Electron/Tauri wrapper: same DOM work plus bundling cost and user leaves real browser.
- Native global-hotkey app: only path for unfocused control, but no DOM access and focus-race flakiness.

## Consequences

- Single-key shortcuts live in-page, not in `chrome.commands`; globals deferred to Phase 3.
- Service worker stays stateless with settings in `chrome.storage`; YouTube DOM treated as volatile with layered selectors and self-test.
