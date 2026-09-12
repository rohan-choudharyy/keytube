# keytube — Full-Keyboard YouTube Control: Research Findings

**Date:** 2026-09-09
**Question:** How to build "keytube" — a project that lets a user control YouTube entirely from keyboard, fast: from media controls (play/pause, seek, volume, speed, next/prev, fullscreen, theater) to selecting a certain video in feed/timeline/search results with a single keypress. Everything keyboard-driven, minimal latency.
**Method:** Primary sources only. Every factual API/method/key claim below carries an inline citation URL to the source that owns it.

## TL;DR Recommendation

Build **Option A: Chrome/Edge MV3 extension with a content script** as the MVP. It is the only option that gives low-latency, in-page DOM + `<video>` control plus install/update distribution, while staying within store policy.

- YouTube already covers player-local keys well (`k`/`j`/`l`/`m`/`f`/`c`/`0-9`, arrows, `Shift+N`/`Shift+P`, `/`, `i`) — https://support.google.com/youtube/answer/7631406 — but has **no single-key "open video N in feed/search"** model. That is keytube's gap to fill.
- **Do not use the YouTube IFrame Player API on youtube.com.** It is for embeds you own (`new YT.Player`, `playVideo()`/`seekTo()` etc.) — https://developers.google.com/youtube/iframe_api_reference — not for driving the youtube.com watch page. On youtube.com, drive the native `<video>` element + `#movie_player` click/keyboard bridge instead (DOM = volatile, see §6).
- Use a **content script** (`matches: *://*.youtube.com/*`, `run_at: document_idle`, isolated world) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts — with a **single capture-phase `keydown` listener + `MutationObserver` pre-index** — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver — and `KeyboardEvent.key` handling — https://www.w3.org/TR/uievents/ — to hit <50ms key-to-action.
- Use **`chrome.commands`** only for 2–4 global/pinned shortcuts (it requires `Ctrl`/`Alt`, max 4 suggested keys, globals limited to `Ctrl+Shift+0..9`) — https://developer.chrome.com/docs/extensions/reference/api/commands — and implement all single-key shortcuts in-page. Use **Media Session API** (`navigator.mediaSession.setActionHandler("play"|"pause"|...)`) — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API and https://www.w3.org/TR/mediasession/ — only to *receive* OS/media-key events, not to get background-global control for free.
- Keep all hot-path logic in the content script; treat the MV3 service worker as disposable (dies after ~30s idle) — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle — and persist only settings in `chrome.storage`.

---

## 1. What YouTube already does natively vs. gaps

Source fetched and verified: https://support.google.com/youtube/answer/7631406

Native player keys (all claims from that page):

- `k` = Pause/Play in player — https://support.google.com/youtube/answer/7631406
- `Spacebar` = Play/Pause when seek bar selected / activate focused button — https://support.google.com/youtube/answer/7631406
- Play/Pause Media Key, Stop Media Key, Next Track Media Key are natively mapped (Play/Pause, Stop, next-track-in-playlist) — https://support.google.com/youtube/answer/7631406
- `m` = mute/unmute — https://support.google.com/youtube/answer/7631406
- `j` = back 10s; `l` = forward 10s — https://support.google.com/youtube/answer/7631406
- `Left/Right arrow on the seek bar` = ±5s — https://support.google.com/youtube/answer/7631406
- `Up/Down arrow on the seek bar` = volume ±5% — https://support.google.com/youtube/answer/7631406
- `Home/End on the seek bar` = beginning / last seconds — https://support.google.com/youtube/answer/7631406
- `0` = beginning; `1..9` = seek to 10%..90% — https://support.google.com/youtube/answer/7631406
- `>` = speed up; `<` = slow down — https://support.google.com/youtube/answer/7631406
- `.` = next frame while paused; `,` = previous frame while paused — https://support.google.com/youtube/answer/7631406
- `Ctrl+→` / `⌥+→` = next chapter; `Ctrl+←` / `⌥+←` = previous chapter — https://support.google.com/youtube/answer/7631406
- `f` = fullscreen toggle (also `Esc` to exit); `c` = captions toggle; `i` = Miniplayer; `/` = go to search box — https://support.google.com/youtube/answer/7631406
- `Shift+N` = next video (playlist-aware, else next suggested); `Shift+P` = previous video **only in a playlist** — https://support.google.com/youtube/answer/7631406
- `Shift+?` opens the shortcut cheat sheet; hovering player buttons reveals their shortcut — https://support.google.com/youtube/answer/7631406

Gaps keytube must fill (derived by absence from the same source):

1. **No single-key feed selection.** There is no native "press `3` to open the 3rd video in home/search/watch-next". Native `Tab` navigation exists but is multi-press and slow. This is the core keytube feature.
2. **`Shift+P` gap outside playlists.** Previous-video has no non-playlist binding — https://support.google.com/youtube/answer/7631406 — so history-back/up-next behavior must be custom.
3. **No theater-mode key.** `f` (fullscreen), `i` (miniplayer), `c` (captions) exist, but theater has no documented key — https://support.google.com/youtube/answer/7631406 — so implement via clicking the theater button in `#movie_player`.
4. **Focus-dependent keys.** Arrows/`Space` are documented "on the seek bar" / button-focus-dependent — https://support.google.com/youtube/answer/7631406 — which is why keytube must implement focus-independent handlers (see §5).
5. **No speed presets / precise seek presets.** Native `>`/`<` step rate and `0-9` jump by 10% — https://support.google.com/youtube/answer/7631406 — but no "set 2x" or "±2s/±30s" single keys.

## 2. YouTube IFrame Player API — what exists, and why NOT to use it on youtube.com

Source fetched and verified: https://developers.google.com/youtube/iframe_api_reference

What the API owns (use only if you embed your own player):

- Construction: `new YT.Player('player', {width, height, videoId, playerVars, events})`, requires `onYouTubeIframeAPIReady`, needs `postMessage` support and ≥200×200 viewport — https://developers.google.com/youtube/iframe_api_reference
- Queue: `cueVideoById` / `loadVideoById` / `cueVideoByUrl` / `loadVideoByUrl` (arg or object syntax with `startSeconds`/`endSeconds`), `cuePlaylist` / `loadPlaylist` — https://developers.google.com/youtube/iframe_api_reference
- Transport: `playVideo()` (state → playing=1), `pauseVideo()` (state → paused=2), `stopVideo()` (may land in ended/paused/cued/unstarted), `seekTo(seconds:Number, allowSeekAhead:Boolean)` — https://developers.google.com/youtube/iframe_api_reference
- Playlist: `nextVideo()`, `previousVideo()`, `playVideoAt(index:Number)` — https://developers.google.com/youtube/iframe_api_reference
- Volume: `mute()`, `unMute()`, `isMuted():Boolean`, `setVolume(0-100)`, `getVolume()` — https://developers.google.com/youtube/iframe_api_reference
- Rate: `getPlaybackRate()`, `setPlaybackRate(suggestedRate)` (rounds toward 1 if unsupported; confirm via event), `getAvailablePlaybackRates():Array` — https://developers.google.com/youtube/iframe_api_reference
- Playlist behavior: `setLoop(bool)`, `setShuffle(bool)` — https://developers.google.com/youtube/iframe_api_reference
- Status: `getVideoLoadedFraction():Float (0-1)`, `getPlayerState():Number (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued)`, `getCurrentTime():Number`, `getDuration():Number` — https://developers.google.com/youtube/iframe_api_reference
- Meta: `getVideoUrl():String`, `getVideoEmbedCode():String`, `getPlaylist():Array`, `getPlaylistIndex():Number` — https://developers.google.com/youtube/iframe_api_reference
- Events: `onReady`, `onStateChange` (data = `YT.PlayerState.ENDED/PLAYING/PAUSED/BUFFERING/CUED`), `onPlaybackQualityChange` (small/medium/large/hd720/hd1080/highres), `onPlaybackRateChange`, `onError` (2/5/100/101/150/153), `onApiChange`, `onAutoplayBlocked`; subscribe via constructor `events:{}` or `addEventListener(event,listener)` / `removeEventListener` — https://developers.google.com/youtube/iframe_api_reference
- DOM utils: `getIframe():Object`, `destroy():Void`, `setSize(w,h)`, `getOptions()/getOption/setOption` (captions `fontSize`/`reload`) — https://developers.google.com/youtube/iframe_api_reference

Critical constraint for keytube:

- The IFrame API controls **embeds you create**. youtube.com's watch player is not your `YT.Player` instance; you cannot `new YT.Player` over it from a content script in the isolated world and expect supported control. On youtube.com, control the native `HTMLMediaElement` (`video.play()/pause()/currentTime/volume/playbackRate/requestFullscreen`) and synthesize clicks/keys on `#movie_player`. Reserve the IFrame API for a future "keytube embeds a player" mode only.

## 3. Chrome Extensions MV3 — content scripts, commands, service-worker limits

Sources fetched and verified:
https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts ,
https://developer.chrome.com/docs/extensions/reference/api/commands ,
https://developer.chrome.com/docs/extensions/mv3/intro/ (redirects to migrate hub; lifecycle details at https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

### 3.1 Content scripts (hot path for keytube)

- Content scripts "run in the context of web pages", can "read details of the web pages", "make changes to them" via the standard DOM — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Directly accessible extension APIs from a content script are limited to `dom`, `i18n`, `storage`, `runtime.connect/getManifest/getURL/id/onConnect/onMessage/sendMessage`; everything else requires messaging to other extension parts — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Other extension files are reachable via `fetch()` + `chrome.runtime.getURL()`, but must be declared as `web-accessible-resources` (which also exposes them to page scripts) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- **Isolated worlds:** content script, page, and other extensions each run in a "private execution environment that isn't accessible to the page"; "JavaScript variables in an extension's content scripts are not visible to the host page" — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
  - Implication: to call page JS objects (e.g. `movie_player` JS API) you must either use DOM/events or inject a `world: MAIN` script (`ExecutionWorld`) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
  - CSP for isolated-world content scripts: `script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' chrome-extension://...; object-src 'self';` — no `eval()`, no remote scripts — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
  - Page↔content-script bridge pattern is `window.postMessage()` relayed via `chrome.runtime.connect()/postMessage` — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Registration: static `content_scripts: [{matches, js, css}]` in manifest (first-injected, in manifest order), dynamic via `chrome.scripting.registerContentScripts/getRegisteredContentScripts/updateContentScripts/unregisterContentScripts`, or programmatic via `chrome.scripting.executeScript({target:{tabId}, files|func|args})` (injected `func` must be self-contained; closure refs throw `ReferenceError`) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Scoping: `matches` (required match patterns), `exclude_matches`, `include_globs`/`exclude_globs` (emulate Greasemonkey `@include/@exclude`; `*` = any string incl. empty, `?` = single char) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Timing: `run_at: document_idle` (preferred default; between `document_end` and after `window.onload`, DOM complete so no need to wait `window.onload` — check `document.readyState` if post-load needed) vs `document_start` (after CSS, before DOM/scripts) vs `document_end` (DOM complete, subresources pending) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Frames: `all_frames:true` / `allFrames:true` to inject into all frames vs top frame only; `match_origin_as_fallback:true` (+ path `*`) to cover `about:/data:/blob:/filesystem:` frames created by a matching initiator; `match_about_blank` for `about:blank` — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- For keytube: `matches: ["*://*.youtube.com/*"]`, `run_at: "document_idle"`, `all_frames: false` (YouTube player is top-frame; avoid double-handling in embeds).

### 3.2 Commands API (only for a few pinned shortcuts)

- Purpose: "add keyboard shortcuts that trigger actions in your extension", declared as `"commands"` object in manifest — https://developer.chrome.com/docs/extensions/reference/api/commands
- Each command: `suggested_key` (string or per-OS `{default, chromeos, linux, mac, windows}`) + `description` (shown in shortcut UI) — https://developer.chrome.com/docs/extensions/reference/api/commands
- **Max 4 suggested shortcuts** per extension ("may specify at most four suggested keyboard shortcuts"; user can add more at `chrome://extensions/shortcuts`) — https://developer.chrome.com/docs/extensions/reference/api/commands
- Allowed keys: `A..Z` (case-sensitive), `0..9`, `Comma/Period/Home/End/PageUp/PageDown/Space/Insert/Delete`, `Up/Down/Left/Right`, `MediaNextTrack/MediaPlayPause/MediaPrevTrack/MediaStop`, modifiers `Ctrl/Alt/Shift/MacCtrl/Option/Command/Search` — https://developer.chrome.com/docs/extensions/reference/api/commands
- Hard requirements: must include **either `Ctrl` or `Alt`**; modifiers **cannot** combine with Media Keys; `Shift` optional; `Ctrl+Alt` banned (AltGr conflict); OS/Chrome shortcuts always win — https://developer.chrome.com/docs/extensions/reference/api/commands
- Handling: `chrome.commands.onCommand.addListener((command)=>...)` in service worker; inspect collisions at install with `chrome.commands.getAll()` (blank `shortcut` = unassigned) — https://developer.chrome.com/docs/extensions/reference/api/commands
- Reserved action commands: `_execute_action` (MV3) / `_execute_browser_action` / `_execute_page_action` (MV2) trigger the toolbar action and do **not** fire `command.onCommand` — https://developer.chrome.com/docs/extensions/reference/api/commands
- Scope: default = browser-focused only. Opt-in `"global": true` works while Chrome unfocused, **except ChromeOS (no global support)**; global suggestions limited to **`Ctrl+Shift+[0..9]`** to avoid hijacking other apps; user can remap at `chrome://extensions/shortcuts` — https://developer.chrome.com/docs/extensions/reference/api/commands
  - Implication: single-key (`j`, `1`, `g h`) shortcuts **cannot** be `chrome.commands`. They must live in the content-script `keydown` handler. Reserve `chrome.commands` for e.g. toggle-overlay, play/pause-global.

### 3.3 MV3 service-worker limits (keep hot path out of it)

- MV3 replaces background/event pages with a service worker to stay "off the main thread" — https://developer.chrome.com/docs/extensions/mv3/intro/
- Lifecycle: `install` → `chrome.runtime.onInstalled` → `activate`; `chrome.runtime.onStartup` on profile start with no SW events — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- **Idle/shutdown:** Chrome terminates SW when: **30s inactivity** (event/API call resets), **single request >5min**, **`fetch()` response >30s**; incoming events revive it — design to be "resilient against unexpected termination" — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- **No globals:** "Any global variables you set will be lost"; persist in `chrome.storage` / IndexedDB / CacheStorage; **Web Storage API is not available** in extension SW — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Lifetime extensions (pin `minimum_chrome_version` if you rely on them): alarms min 30s (Ch116/120), WebSocket traffic resets idle timer (116), long-lived ports/messages, offscreen docs, `connectNative` keep-alive behaviors — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
  - Implication: key handling, overlay index, and `<video>` control must live in the **content script** (persistent while page lives), not the SW.

## 4. Media Session API — OS-level media keys, metadata, action handlers

Sources fetched and verified:
https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API ,
https://www.w3.org/TR/mediasession/

- Purpose: "customize media notifications" via metadata + "action handlers that the browser can use to access platform media keys such as hardware keys found on keyboards, headsets, remote controls, and software keys found in notification areas and on lock screens" — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
- Goal: "know what's playing and control it, without needing to open the specific page" — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
- Entry: `navigator.mediaSession` returns the `MediaSession`; e.g. `navigator.mediaSession.playbackState = "playing"` — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
- Metadata: `navigator.mediaSession.metadata = new MediaMetadata({title, artist, album, artwork:[{src,sizes,type}]})` — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API ; spec IDL: `MediaMetadata{title,artist,album,artwork,chapterInfo}` + `MediaMetadataInit` + `MediaImage{src,sizes,type}` — https://www.w3.org/TR/mediasession/
- Actions (register): `navigator.mediaSession.setActionHandler("play"|"pause"|"stop"|"seekbackward"|"seekforward"|"seekto"|"previoustrack"|"nexttrack"|"skipad"|"togglemicrophone"|"togglemicrophone"|"hangup"|"previousslide"|"nextslide"|...)` — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API ; full enum adds `togglecamera/togglescreenshare/enterpictureinpicture/voiceactivity` — https://www.w3.org/TR/mediasession/
- Position: `setPositionState({duration, playbackRate, position})` (duration required, non-negative; position defaults 0; playbackRate defaults 1.0, non-zero) + clear with `{}` — https://www.w3.org/TR/mediasession/
- Playback state model: `playbackState: "none"|"paused"|"playing"` (declared hint) combined with guessed state (any potentially-playing non-muted media) into actual state; drives which of play/pause is offered — https://www.w3.org/TR/mediasession/
- Routing: "user agent MUST select at most one of the MediaSession objects to present to the user, which is called the active media session" (may be null; should be audio-focus-based; `playbackState` MUST NOT affect routing) — https://www.w3.org/TR/mediasession/
- Dispatch: on action trigger, UA queues a task (user-interaction source) to the target session (explicit target or active session); joint play/pause hardware button maps to `pause` if actual state is playing else `play`; UA SHOULD provide default play/pause handlers if page registered none — https://www.w3.org/TR/mediasession/
- Scope/limits for keytube:
  - Media Session lets your **page receive** OS keys while it is the active session — it does **not** give a content script global hotkeys when Chrome is unfocused/minimized. For unfocused control you need `chrome.commands global:true` (with its `Ctrl+Shift+0..9` limit and no ChromeOS support) — https://developer.chrome.com/docs/extensions/reference/api/commands — or a native helper (see §7).
  - YouTube already sets its own MediaSession; keytube overriding handlers can conflict — prefer *augmenting* (`previoustrack/nexttrack` → playlist/up-next logic) and always allow `null` to unregister.

## 5. W3C UI Events / KeyboardEvents — single-key handling without lag or focus bugs

Source fetched and verified: https://www.w3.org/TR/uievents/

- Model: UI Events extend DOM `Event` objects "for handling user interaction such as mouse and keyboard input" — https://www.w3.org/TR/uievents/
- Core primitives: `Event{type,target,currentTarget,eventPhase,bubbles,cancelable,composed,timeStamp,defaultPrevented,isTrusted,stopPropagation/stopImmediatePropagation/preventDefault/initEvent}`, `EventTarget{addEventListener/removeEventListener/dispatchEvent}`, `CustomEvent{detail}`, `Document.createEvent()` — https://www.w3.org/TR/uievents/
- Keyboard: `KeyboardEvent` interface; types **`keydown`** and **`keyup`** (both Sync, Bubbles=Yes, trusted target=Element, Cancelable=Yes) — https://www.w3.org/TR/uievents/
- `keydown` default actions include: trigger `beforeinput`/`input`, launch text composition, `blur`/`focus`, `keypress` (if supported), activation behavior — https://www.w3.org/TR/uievents/
- Key identity: use `KeyboardEvent.key` (e.g. `"ArrowDown"`, `"="`, `"q"/"Q"`) and `code` (e.g. `"ArrowDown"`, `"Equal"`, `"KeyQ"`); spec distinguishes key-cap legend vs `key` vs `code` — https://www.w3.org/TR/uievents/
- Focus: `FocusEvent{relatedTarget}`; types `blur`/`focus` (no bubble) and `focusin`/`focusout` (bubble); order on tab-switch: `blur→focusout→focus→focusin` — https://www.w3.org/TR/uievents/
- Input/composition: `InputEvent{beforeinput,input}` on Element; `CompositionEvent{compositionstart/update/end}` — https://www.w3.org/TR/uievents/

Implementation rules for keytube (derived directly from the above):

1. Listen once at `document` (capture) for `keydown` — one listener leverages bubbling instead of per-thumbnail listeners. Call `preventDefault()` only for keys you actually consume (they are cancelable) — https://www.w3.org/TR/uievents/
2. Read `e.key` (not legacy `keyCode`/`which`); normalize with `e.key.toLowerCase()` for letters, and branch on `e.code` only for layout-sensitive positions. Ignore `e.repeat` for overlay toggles/selection.
3. Focus guard (biggest YouTube conflict source): if `document.activeElement` is `INPUT/TEXTAREA/[contenteditable]` or YouTube search (`input#search`), **pass through** everything except your explicit escape hatch (e.g. `Esc`/`Ctrl+Enter`). Also skip when `e.isTrusted===false` (synthetic) or an IME composition is active (`compositionstart` fired, `isComposing` true) — https://www.w3.org/TR/uievents/
4. Iframe focus: player iframe eats keys. Prefer top-frame handling (`all_frames:false`) + clicking/focusing `#movie_player` before synthesizing player keys, or drive `<video>` directly so focus doesn't matter.
5. Use `keyup` only for chord teardown; never for primary activation (adds ~key-travel latency vs `keydown`).

## 6. YouTube.com actual DOM — volatile, client-rendered (resilient-selector strategy)

Probe performed: `WebFetch https://www.youtube.com/` returned only the static shell (About/Press/Copyright/Developers/Terms/Privacy links, `© 2026 Google LLC`) with **none** of the app nodes. This confirms youtube.com is a client-rendered SPA: server HTML has no video list; the app DOM is built at runtime. Treat all selectors below as **volatile**.

Target patterns (to verify live in DevTools; do NOT hard-code a single selector):

- Feed/search items: `ytd-rich-item-renderer` (home), `ytd-video-renderer` (search), `ytd-compact-video-renderer` / `ytd-playlist-panel-video-renderer` (watch-next/playlist), `ytd-reel-item-renderer` / `ytd-shorts` (Shorts shelf — decide in/out of scope).
- Player: `#movie_player`, `.html5-video-player`, inner `video.html5-main-video`.
- Links: `a#thumbnail`, `a#video-title`, `a.yt-simple-endpoint`.

Resilient strategy:

1. **Layered selectors:** `querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer')` → filter by `:not([hidden])` + `offsetParent!==null` + `getBoundingClientRect().width>0` + visible viewport intersection. Never index hidden/off-screen nodes for badges.
2. **`MutationObserver` pre-index, not polling:** `new MutationObserver(cb).observe(root,{childList:true,subtree:true})` with `disconnect()`/`takeRecords()` available — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver — debounced via `requestAnimationFrame`/`queueMicrotask`; incremental index update (addedNodes/removedNodes) instead of full re-query. Polling (`setInterval(querySelectorAll)`) is the latency/jank anti-pattern.
3. **Event delegation:** one `document` `keydown` + one `click` delegate; resolve `event.target.closest('ytd-...-renderer a#thumbnail')`. Avoid per-card listeners.
4. **Click the real link:** call `.click()` on the thumbnail anchor (or `location.assign(url)`) rather than reimplementing navigation — survives SPA-router changes better than calling internal polymer methods.
5. **Version-pin + self-test:** on load, assert "≥1 selector family matched"; if zero, show "YouTube layout changed — update selectors" instead of failing silently. Keep a `SELECTORS` constant with fallbacks ordered newest→oldest.
6. **MAIN-world bridge only if needed:** most needs are met in ISOLATED world via DOM; if you must call `movie_player.getPlayerState()`-style page JS, inject a `world:'MAIN'` shim that `postMessage`s results out — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

## 7. Architecture options — tradeoffs for speed

| Dimension | A) MV3 extension + content script (recommended) | B) Userscript (Tampermonkey/Violentmonkey) | C) Electron/Tauri wrapper | D) Global-hotkey native (AHK/PowerToys/media keys) |
|---|---|---|---|---|
| Key-to-action latency | **Best in-browser (~5–20ms):** direct DOM + `<video>` in page, `document_idle` injection — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts | Same hot path, but manager overhead + update prompts; no API advantage | Extra IPC + bundled Chromium; slower startup, same DOM work | High + brittle: synthesizes keys/focus-steals; no DOM context |
| Feed hint overlays (video-N pick) | Full DOM + Shadow-DOM pierce + `MutationObserver` — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver | Same, but CSP/grant friction per manager | Same as A inside its Chromium, but user must leave real browser | **Cannot** — no feed DOM access |
| Single-key shortcuts | Full `keydown` control (`key`/`code`, cancelable) — https://www.w3.org/TR/uievents/ | Full, but conflicts with page CSP | Full | Key remap only; conflicts with OS/app shortcuts |
| Works when browser unfocused | Only via `global:true` `Ctrl+Shift+0..9` (no ChromeOS) — https://developer.chrome.com/docs/extensions/reference/api/commands | **No** | **No** (unless global-shortcut lib added = native code anyway) | **Yes** — the one reason to add D as companion |
| Media-key integration | Receive via Media Session handlers — https://www.w3.org/TR/mediasession/ | Same | Same | Native OS hooks; most powerful, most invasive |
| Persistence / settings | `chrome.storage` (SW globals die after 30s idle) — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle | `GM_setValue` (manager-specific) | Full FS/DB | INI/registry |
| Distribution / trust | Chrome Web Store (+ Edge), auto-update, permissions review | Requires manager install; review varies | Separate download; heavy | Script/binary per OS; Gatekeeper/SmartScreen friction |
| Store policy / breakage risk | MV3 CSP + host-permission review; YouTube DOM drift (mitigate §6) | Manager policy + same DOM drift | ToS ambiguity of scraping wrapper; same DOM drift + bundling cost | AV/permission flags; focus-race flakiness |
| Verdict | **MVP.** Fastest real solution. | Best prototype in <1h; graduate to A. | Reject unless offline/desktop shell is a goal. | Companion only for unfocused media keys. |

## 8. Vimium-style hint / number-badge design (minimal latency)

1. **Pre-index, lazy overlay.** Maintain `items: Array<{el, link, rect}>` continuously via `MutationObserver` (`childList+subtree`) — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver — but render badges only while hint mode is armed (e.g. `f` or `;`). No layout work when idle.
2. **Index pass without thrash:** single `querySelectorAll` per families, filter visible, cache `getBoundingClientRect()` once per open (not per keystroke). Use `transform: translate()` absolute-positioned badges in one container with `contain: layout paint`; `pointer-events:none`.
3. **Label scheme:** `1..9` → first 9 visible; beyond: two-char home-row (`aa, as, ad...` Vimium-style) or `1..9,a..z` then `g+key` paging. Single-keypress promise holds for the common case (first screen ≈ 6–12 videos).
4. **Activation:** on label match, `link.click()` (or `link.focus(); link.click()`). For background-open: `Ctrl+click` equivalent via `chrome.tabs.create` is SW-side — keep MVP to same-tab `.click()` to avoid messaging latency.
5. **Filter-as-you-type (optional phase 2):** buffer typed chars, fuzzy-match titles, highlight best match on `Enter`. Keep buffer reset on `Esc`/navigation.
6. **SPA awareness:** YouTube uses soft navigation; re-run index on `yt-navigate-finish` event + `MutationObserver` burst + `document.visibilitychange`. Never `setInterval`.
7. **Perf budget:** `keydown→action` <50ms means: no `querySelectorAll` in handler (read cache), no forced sync layout (no interleaved read/write), no network, no SW round-trip (`chrome.runtime.sendMessage` is async — avoid on hot path) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

## 9. Conflict avoidance (YouTube's own shortcuts, search, iframe)

1. **Never steal typing.** If focus is in `input, textarea, [contenteditable], #search input`, ignore all single-key bindings; only `Esc` exits focus/hint mode. (`/` focuses search natively — https://support.google.com/youtube/answer/7631406 — so don't rebind `/` when already typing.)
2. **Don't double-fire player keys.** If you implement custom `k/j/l/m/f/c` handling, `preventDefault + stopImmediatePropagation` in capture phase and drive `<video>` directly; otherwise defer to native and only add *new* keys. Pick one owner per key.
3. **Numbers are contested.** `0-9` natively seek 0%..90% in player — https://support.google.com/youtube/answer/7631406. Rule: when watch player focused/playing → numbers seek; when hint mode armed or focus is feed (no player) → numbers select video. Make mode explicit in badge UI.
4. **`Space` is dangerous.** Native `Space` toggles play only when seek bar/button focused — https://support.google.com/youtube/answer/7631406 — but page scroll otherwise. If you bind `Space`, scope it to player context and `preventDefault` to avoid scroll.
5. **Announce mode.** Show a 14px pill (`keytube: HINTS 1-9` / `keytube: PLAYER`) so users can predict number-key behavior.
6. **Iframe trap.** If `document.activeElement` is inside player iframe/embed, keys may never reach top document. Mitigate with `all_frames:false` + explicit `movie_player.focus()` before synthetic keys, or bypass keys entirely via `<video>` properties.

## 10. Global media-key support when browser not focused

- **In-Chrome (focused or active-session):** register Media Session handlers (`play/pause/previoustrack/nexttrack/seekbackward/seekforward/seekto/stop`) — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API and https://www.w3.org/TR/mediasession/ — plus `setPositionState` so OS UI shows progress. This covers headset/BT/notification/lockscreen keys routed to the active session — https://www.w3.org/TR/mediasession/
- **Chrome unfocused:** only `chrome.commands` with `"global":true` works, capped at `Ctrl+Shift+0..9`, no ChromeOS — https://developer.chrome.com/docs/extensions/reference/api/commands. Plan for exactly 1–2 globals (e.g. Play/Pause, Next). Everything else stays in-page.
- **Truly global (browser minimized/closed):** out of scope for the extension sandbox. Companion options: AutoHotkey `Media_Play_Pause/Media_Next/Media_Prev` sendkeys, PowerToys Keyboard Manager remap, or a Tauri/native tray helper that calls back via Native Messaging. Document as Phase 3; warn about focus-steal races.
- **Autoplay caveat:** browsers may block scripted `playVideo()`-style playback without user gesture; IFrame API surfaces `onAutoplayBlocked` — https://developers.google.com/youtube/iframe_api_reference — so all remote-play paths must be tested against autoplay policy with a prior user activation.

## 11. Performance checklist (<50ms key-to-action)

- [ ] One capture-phase `document` `keydown` listener; `e.key`-based dispatch table (no if-else chains) — https://www.w3.org/TR/uievents/
- [ ] Zero DOM queries in handler: read pre-built index; `MutationObserver`-maintained — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
- [ ] Zero forced layout: batch `getBoundingClientRect` on overlay open only; badges use `transform`; container has `content-visibility/contain`
- [ ] No `chrome.runtime.sendMessage` / `chrome.storage` reads on hot path (cache settings in content-script memory; SW may be dead after 30s idle) — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- [ ] Direct `<video>` control (`play()/pause()/currentTime+=/-=/volume/playbackRate`) over synthetic key events where possible
- [ ] Debounce `MutationObserver` bursts with `requestAnimationFrame`; `takeRecords()` drain on mode exit — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
- [ ] Measure: `performance.now()` around handler; log p50/p95 to console in dev; assert p95 <50ms on 100-item feed
- [ ] Test matrix: home, search, watch, playlist, channel, Shorts-shelf present/absent, theater/fullscreen/miniplayer (`f`/`i` — https://support.google.com/youtube/answer/7631406), signed-out, slow-3G

## 12. Minimal MVP scope + phased roadmap

**MVP (1–2 weeks, extension only):**

1. Manifest MV3 + content script on `*://*.youtube.com/*` (`document_idle`) — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
2. Player layer (watch page): `k/space` play-pause, `j/l` ∓10s (mirror native — https://support.google.com/youtube/answer/7631406), `h/;` or arrows ∓5s, `u/o` volume, `>/<` rate, `f` fullscreen, `t` theater (click), `c` captions, `n/p` next/prev incl. non-playlist fallback
3. Feed layer: `f`-armed number badges `1-9` over `ytd-rich-item-renderer/ytd-video-renderer/ytd-compact-video-renderer` → single key `.click()`; `Esc` exits; focus guard for search (`/` native — https://support.google.com/youtube/answer/7631406)
4. Media Session receive-only: `play/pause/previoustrack/nexttrack` handlers + `playbackState`/`setPositionState` — https://www.w3.org/TR/mediasession/
5. Options page: 3 toggles (hint labels, theater key, disable-on-Shorts) persisted in `chrome.storage` (not SW globals) — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
6. Self-test banner when no selectors match (DOM-drift signal).

**Phase 2:** two-char hints, title filter, `g h/g s/g w` navigation chords, `0-9` context rule (seek vs select), per-site toggle, `chrome.commands` for toggle-overlay + play/pause (≤4 suggested) — https://developer.chrome.com/docs/extensions/reference/api/commands

**Phase 3:** global `Ctrl+Shift+0..9` media keys, AHK/PowerToys companion script, Miniplayer (`i` — https://support.google.com/youtube/answer/7631406) + playlist `playVideoAt`-style queue jumps, chapters via `Ctrl+Arrow` parity — https://support.google.com/youtube/answer/7631406

**Non-goals for MVP:** downloads, ad-skip automation, Shorts-first UX, mobile, Firefox port (WebExtensions `browser.*` differs).

## 13. Open risks

1. **YouTube DOM drift (HIGH).** `ytd-*-renderer` / `#movie_player` / `.html5-video-player` are undocumented and change without notice (probe showed server HTML is just a shell — volatility confirmed). Mitigate: layered selectors, `MutationObserver` index, version self-test, weekly CI that loads youtube.com and asserts selector hits.
2. **Store policy (MEDIUM).** MV3 review flags broad host permissions + remote code; keep `host_permissions` to `*://*.youtube.com/*`, bundle all code (no remote `eval` — CSP bans it — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), justify `scripting/tabs/storage` minimally.
3. **MV3 SW limits (MEDIUM).** 30s idle kill / 5-min cap / no DOM / no Web Storage — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle. Mitigate: stateless SW, hot path in content script.
4. **`chrome.commands` ceiling (MEDIUM).** 4 suggested keys, `Ctrl/Alt` required, globals `Ctrl+Shift+0..9` only, no ChromeOS globals, OS shortcuts win — https://developer.chrome.com/docs/extensions/reference/api/commands. Mitigate: in-page single keys + 1–2 globals max.
5. **Media Session contention (LOW-MED).** YouTube owns its session; UA picks a single active session — https://www.w3.org/TR/mediasession/. Overriding all handlers can break YouTube's OS UI; augment narrowly.
6. **Focus/keyboard regressions (LOW).** Search-box capture, iframe swallow, IME composition — handle via `activeElement`/`isComposing` guards per UI Events semantics — https://www.w3.org/TR/uievents/
7. **Autoplay/policy (LOW).** Scripted play may hit `onAutoplayBlocked`-class blocks — https://developers.google.com/youtube/iframe_api_reference. Require prior gesture; test headless.

## Sources (primary only — all fetched, not guessed)

1. YouTube native shortcuts — https://support.google.com/youtube/answer/7631406
2. YouTube IFrame Player API — https://developers.google.com/youtube/iframe_api_reference
3. Chrome content scripts — https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
4. Chrome commands API — https://developer.chrome.com/docs/extensions/reference/api/commands
5. Chrome MV3 intro / migrate hub — https://developer.chrome.com/docs/extensions/mv3/intro/
6. Extension service-worker lifecycle — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
7. MDN Media Session API — https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
8. W3C Media Session spec — https://www.w3.org/TR/mediasession/
9. W3C UI Events spec — https://www.w3.org/TR/uievents/
10. MDN MutationObserver — https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
11. youtube.com live probe (client-rendered shell confirmation) — https://www.youtube.com/
