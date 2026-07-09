# Changelog

All notable changes to Hoverlay are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com), and versions follow
[semantic versioning](https://semver.org).

## [Unreleased]

## [0.3.0] - 2026-07-09

### Added

- Pin now means "keep open until closed": a pinned preview survives the
  pointer leaving, clicks and scrolling outside, and modifier release, in
  both dismissal modes, so you can type in a note with a preview pinned
  alongside (previously any outside click closed it). The pin button also
  appears in sticky mode now, and hovering other links no longer replaces
  a pinned preview
- Live previews are interactive: click into one to give the page keyboard
  focus and type (sign into sites, use search boxes). Escape still closes,
  forwarded out of the focused page; hover dismissal pauses while the page
  holds the keyboard; pages that try to grab focus on load without a click
  are refused so hovering never steals the keyboard mid-typing
- Close on Escape toggle (default on), for Vim users, where Escape is part
  of typing and would keep dismissing pinned previews
- Remember preview logins toggle (default off): by default anything you
  sign into inside a preview stays signed in only until Obsidian quits and
  never touches disk; opt in to keep preview logins across restarts

### Changed

- Live previews browse in their own isolated cookie storage instead of
  Electron's default session, so preview browsing can no longer read or
  write Obsidian's app-wide cookies (previews that inherited logins from
  other webview surfaces, like Canvas embeds, start signed out; sign in
  inside a preview instead)
- Embedded players now declare obsidian.md as their embedding site (a
  Referer header on the player load only, never on ordinary page
  previews); YouTube refuses referrer-less embeds from isolated sessions
  with player error 153

### Known limitations

- Sites whose login opens a separate popup window (some OAuth flows) can't
  complete inside a preview: Obsidian's main process denies popup windows
  from embedded pages. Logins that redirect within the same page work.
  HTTP basic-auth prompts are also unavailable to plugins

## [0.2.0] - 2026-07-08

### Added

- Hover previews inside Canvas text cards (canvas covers card content
  with an event blocker; links under the pointer are now hit-tested
  through it)
- Pop-out window support: hovers in pop-outs open the popover in that
  window, with per-window listeners and viewport math
- Six more embed providers: Dailymotion (and dai.ly links), Streamable,
  Loom, Apple Music, Apple Podcasts and Deezer

### Fixed

- Link resolution no longer relies on constructor identity anywhere,
  fixing editor links and reader clicks inside pop-out windows across
  Obsidian versions

## [0.1.2] - 2026-07-08

Community plugin review pass.

### Fixed

- Reader mode appends sanitized article content as DOM nodes instead of
  writing an HTML string
- Bumped @mozilla/readability past a published security advisory

### Changed

- Cross-window-safe idioms throughout (activeDocument, instanceOf) as
  groundwork for pop-out window support
- Release assets now ship with GitHub build-provenance attestations

## [0.1.1] - 2026-07-08

### Fixed

- Popovers wider or taller than the viewport are capped to fit, so the
  header controls stay on-screen on narrow (mobile) displays

## [0.1.0] - 2026-07-08

Initial release.

### Preview

- Hover any external link to preview it in a floating popover, in reading
  view, live preview and source mode (editor links are resolved from the
  CodeMirror document, so folded `[text](url)` links work)
- Live page previews render in an Electron webview, so sites that refuse
  iframe embedding (most of the modern web) still load
- Reader mode: article extraction (Mozilla Readability) rendered in your
  theme's typography, sanitized, with no scripts ever executing
- Metadata card: OpenGraph/Twitter card with title, description, image and
  favicon; automatic fallback whenever a richer mode can't render
- Embedded players: YouTube, Vimeo, Spotify and SoundCloud links load the
  provider's embed player, preserving playlists and timestamps; the popover
  trims itself to the player's natural size (fixed card heights, 16:9
  letterboxing), shrinking at most one dimension and never growing
- Scheme-less links (`[site](www.example.com)`, bare `github.com/user` in
  editor text) are normalized, gated behind a known-TLD list and resolved
  against the vault so notes are never mistaken for domains

### Popover

- Header with live URL readout, back/forward history, open in browser,
  maximize/restore, pin, mute and close
- Drag the header to reposition; drag any edge or corner to resize, with
  optional persistence of the resized size
- Scroll-zoom with a configurable key (or off), a transient percentage
  badge, and a volume slider flyout on the speaker button
- Mouse back/forward buttons drive the preview's history without hijacking
  Obsidian's note navigation
- Embeds start audible; ordinary pages stay muted until unmuted

### Control

- Trigger modifiers (any combination of Ctrl/Alt/Shift/Cmd), optional
  close-on-release, hover and sticky dismissal modes, hover/stillness/hide
  delays, per-domain preview modes and a domain blocklist
- "Preview link under cursor" command, bindable to a hotkey

[Unreleased]: https://github.com/zspatter/obsidian-hoverlay/compare/0.3.0...HEAD
[0.3.0]: https://github.com/zspatter/obsidian-hoverlay/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/zspatter/obsidian-hoverlay/compare/0.1.2...0.2.0
[0.1.2]: https://github.com/zspatter/obsidian-hoverlay/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/zspatter/obsidian-hoverlay/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/zspatter/obsidian-hoverlay/releases/tag/0.1.0
