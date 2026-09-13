# Support Card as permanent Ko-fi link in popup and last Tour slide

The Support Card is a permanent, non-dismissable Ko-fi strip between the Binding groups and the footer, plus the last Tour slide (`6/6 · Support keytube`). Both open `https://ko-fi.com/rohvnwho/goal?g=12` in a new tab via `chrome.tabs.create`, since plain hrefs don't reliably open from a popup. The Tour grows from 5 to 6 slides with no change to the once-only Skip / Done story.

## Considered Options

- Dismissable card with a stored flag: quieter for existing users, but adds state and lets the support ask vanish; rejected for v1.
- Card inside the header `.card` or footer: header crowds the hero, footer buries the ask; standalone strip rejected both.
- Ko-fi pink / amber highlight: on-brand but weaker contrast on the dark glass theme; Ko-fi blue `#29ABE0` with dark button text picked for 4.5:1 text contrast.

## Consequences

- No new permissions and no backend or login; both entry points share one `KOFI_URL`.
- The Support Card is never an Action: it has no Binding, no `kbd` chip, and its own `.support-card` styles so it can't be mistaken for remappable UI.
- Tour copy stays read-only; the slide-6 CTA is a static anchor shown only on the last slide.
