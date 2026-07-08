# Hoverlay

Link previews on hover for Obsidian that work on real websites.

## Why another link preview plugin

The existing hover-preview plugins render external pages in an `<iframe>`. Any site that sends `X-Frame-Options` or a CSP `frame-ancestors` header (GitHub, Reddit, Wikipedia, most of the web you actually link to) refuses to render in an iframe, and the refusal is silent, so the preview just shows a blank pane. Hoverlay avoids that class of failure entirely:

- **Desktop:** previews render in an Electron `<webview>`, a separate guest page doing top-level navigation. Framing headers do not apply to it. This is the same mechanism Canvas web embeds use.
- **Reader mode (optional):** fetches the page, extracts the article with Mozilla Readability, sanitizes it with DOMPurify, and renders just the text in your theme's typography. No scripts or trackers ever run.
- **Embedded players (auto mode):** media links (YouTube, Vimeo, Spotify, SoundCloud) load the provider's embedded player instead of the full page: lighter, no cookie walls, playlist and timestamp parameters preserved. Embeds start with audio on while ordinary pages stay muted against autoplay noise; a header speaker button toggles either. Globally toggleable, `host: webview` forces the full page for a site, `host: embed` forces the player even with the global toggle off.
- **Mobile, or when a page still fails to load:** Hoverlay fetches the page through Obsidian's `requestUrl` (a main-process request, immune to CORS), parses OpenGraph/Twitter metadata, and renders a compact card with title, description, image and favicon. No third-party preview APIs, no keys.

## Behavior

- Works in reading view, live preview, and source mode. In the editors, the hovered link is resolved from the CodeMirror document itself rather than the DOM, so live preview's folded `[text](url)` links work even though the URL never appears on screen.
- Hover an external link, wait the configured delay (default 400 ms), get a preview.
- Scheme-less links (`[site](www.foo.com)`, `github.com/user` in plain editor text) are normalized to `https://` automatically; bare domains are gated behind a known-TLD list so file names like `notes.txt` never preview. Obsidian resolves scheme-less hrefs against the app origin, which is why other preview plugins silently ignore them.
- Drag the header to reposition a popover (per-popup, nothing persists). Zooming shows a transient percentage badge in the header; clicking it resets zoom to 100%.
- Navigating to links inside a live preview reveals back/forward buttons in the header, the URL readout follows along, and "Open in browser" opens the page you're looking at now. Mouse back/forward buttons work over the preview too, without hijacking Obsidian's note navigation elsewhere.
- The popover stays open while the pointer is over it. Dismissal is configurable: hover mode closes shortly after the pointer leaves, sticky mode waits for Escape or a click anywhere else. Escape always closes.
- Drag the right/bottom edges or the corner to resize; optionally the new size persists as the default.
- A slim header bar shows the hostname plus maximize (fills the Obsidian window, toggles back), open in browser, and close buttons. While maximized, hover dismissal is suspended; close via Escape, the X, or restore.
- Hold Ctrl/Cmd and scroll over an open preview to adjust the page zoom. (Holding the key overlays a shield so the zoom scroll reaches the plugin instead of scrolling the embedded page.)
- Internal links are untouched; core Page preview owns those.

## Settings

- Preview mode: auto (webview on desktop, card on mobile) / live page / reader / card, plus per-domain overrides (`host: mode`, most specific entry wins)
- Trigger modifiers: any combination of Ctrl, Alt, Shift, Cmd/Win (or none for plain hover), with optional close-on-release
- Command palette: "Preview link under cursor" (bindable to a hotkey) opens the preview for the link at the editor cursor
- Hover delay, hide grace period, and an optional stillness delay (pointer movement restarts the countdown, guarding against accidental triggers while sweeping across text)
- Dismissal mode: hover or sticky
- Popover size, remember-resized-size toggle, page zoom
- Per-domain blocklist

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # typecheck + production build
```

To test in a vault, copy or symlink `manifest.json`, `main.js`, and `styles.css` into `<vault>/.obsidian/plugins/hoverlay/`, then enable Hoverlay in Community plugins.

### Testing

`npm test` runs two tiers: pure-module unit tests, including exhaustive permutation sweeps for modifier combinations, zoom-key conflict resolution, renderer selection and popover geometry, and jsdom tests covering the popover's interaction behavior (dismissal permutation matrix included), metadata parsing and the reader's sanitization pipeline. New decision logic should arrive as a pure function with a permutation sweep.

CI (`.github/workflows/ci.yml`) gates every push and pull request, and reruns weekly on a schedule to catch upstream drift. Planned third tier: e2e via wdio-obsidian-service driving real Obsidian, matrixed over obsidian-version (earliest supported and latest) and OS (Windows, macOS, Linux).

## Roadmap

- [ ] Canvas card links
- [ ] Persistent metadata cache
- [ ] Per-domain render mode overrides (e.g. always card for slow sites)
