# Changelog

All notable changes to Hoverlay are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com), and versions follow
[semantic versioning](https://semver.org).

## [Unreleased]

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

[Unreleased]: https://github.com/zspatter/obsidian-hoverlay/compare/0.1.1...HEAD
[0.1.1]: https://github.com/zspatter/obsidian-hoverlay/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/zspatter/obsidian-hoverlay/releases/tag/0.1.0
