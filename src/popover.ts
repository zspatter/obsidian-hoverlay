import { Platform, setIcon } from "obsidian";
import type { Editor } from "obsidian";
import { EditorView } from "@codemirror/view";
import type HoverlayPlugin from "./main";
import { modifiersHeld, isHostBlocked, matchDomainMode, resolveZoomModifier } from "./rules";
import type { ZoomModifier } from "./rules";
import { normalizeUrl, findLinkAtOffset } from "./links";
import { resolveEmbedUrl } from "./embeds";
import { renderWebview } from "./renderers/webview";
import { renderCard } from "./renderers/card";
import { renderReader } from "./renderers/reader";
import type { RendererHandle } from "./renderers/types";

const MIN_WIDTH = 260;
const MIN_HEIGHT = 180;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.05;
const VIEWPORT_MARGIN = 8;
const MAXIMIZE_MARGIN = 24;
/** hover dismissal grace after restoring from maximize, so the popover
 *  doesn't instantly close when the cursor lands outside the restored rect */
const RESTORE_HOVER_SUSPEND_MS = 1500;

interface ResizeEdges {
	left?: boolean;
	right?: boolean;
	top?: boolean;
	bottom?: boolean;
}

const RESIZE_HANDLES: Array<{ cls: string; edges: ResizeEdges }> = [
	{ cls: "e", edges: { right: true } },
	{ cls: "w", edges: { left: true } },
	{ cls: "s", edges: { bottom: true } },
	{ cls: "n", edges: { top: true } },
	{ cls: "se", edges: { right: true, bottom: true } },
	{ cls: "sw", edges: { left: true, bottom: true } },
	{ cls: "ne", edges: { right: true, top: true } },
	{ cls: "nw", edges: { left: true, top: true } },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const px = (value: number) => `${value}px`;

interface PendingHover {
	url: string;
	anchor: HTMLElement;
	moveListener: (() => void) | null;
	leaveListener: () => void;
}

/**
 * Owns the single popover instance: hover detection, debounce, positioning,
 * renderer selection (webview vs card), resizing, zoom and teardown.
 */
export class PopoverManager {
	private plugin: HoverlayPlugin;
	private popoverEl: HTMLElement | null = null;
	private frameEl: HTMLElement | null = null;
	private contentEl: HTMLElement | null = null;
	private renderer: RendererHandle | null = null;
	private currentUrl: string | null = null;
	private displayedUrl: string | null = null;
	private headerUrlEl: HTMLElement | null = null;
	private navEl: HTMLElement | null = null;
	private navBackEl: HTMLElement | null = null;
	private navForwardEl: HTMLElement | null = null;
	private pending: PendingHover | null = null;
	private showTimer: number | null = null;
	private hideTimer: number | null = null;
	private maximized = false;
	private savedRect: { left: string; top: string; width: string; height: string } | null = null;
	private resizing = false;
	private dragging = false;
	private suspendHoverUntil = 0;
	private zoomShieldEl: HTMLElement | null = null;
	private zoomBadgeEl: HTMLElement | null = null;
	private zoomBadgeTimer: number | null = null;
	private muteBtnEl: HTMLElement | null = null;
	private muted = true;
	private isEmbed = false;
	private audioActive = false;
	private pinBtnEl: HTMLElement | null = null;
	private pinned = false;
	private heldKeys = new Set<string>();
	// hover resolution runs on every mouseover in the app; skip re-resolving
	// the same element in quick succession (editor scans force layout reads)
	private lastResolveEl: Element | null = null;
	private lastResolveTime = 0;
	private lastResolveResult: { url: string; anchor: HTMLElement } | null = null;

	constructor(plugin: HoverlayPlugin) {
		this.plugin = plugin;
	}

	// ---- event entry points (wired in main.ts) ----

	onMouseOver(evt: MouseEvent): void {
		const target = evt.target;
		if (!(target instanceof Element)) return;

		// keep the popover alive while the pointer is inside it or its handles
		if (this.popoverEl && this.popoverEl.contains(target)) {
			this.cancelHide();
			this.suspendHoverUntil = 0; // pointer is back; resume normal dismissal
			return;
		}

		const now = performance.now();
		let link: { url: string; anchor: HTMLElement } | null;
		if (target === this.lastResolveEl && now - this.lastResolveTime < 250) {
			link = this.lastResolveResult;
		} else {
			link = this.resolveLink(target, evt);
			this.lastResolveEl = target;
			this.lastResolveTime = now;
			this.lastResolveResult = link;
		}

		if (!link) {
			// pointer wandered off any link; in hover mode let the popover wind down
			if (this.currentUrl && this.plugin.settings.stickyMode === "hover") {
				this.scheduleHide();
			}
			return;
		}

		if (!modifiersHeld(evt, this.plugin.settings.modifiers)) return;

		const { url, anchor } = link;
		if (url === this.currentUrl) {
			this.cancelHide();
			return;
		}
		// same link already counting down: let the timer run instead of restarting it
		if (this.pending && this.pending.url === url) return;

		try {
			const host = new URL(url).hostname;
			if (isHostBlocked(host, this.plugin.blockedHosts)) return;
		} catch {
			return; // unparseable even after normalization
		}

		this.scheduleShow(url, anchor);
	}

	// ---- command entry point: preview the link under the editor cursor ----

	hasLinkAtEditorCursor(editor: Editor): boolean {
		return this.resolveAtEditorCursor(editor) !== null;
	}

	openAtEditorCursor(editor: Editor): boolean {
		const resolved = this.resolveAtEditorCursor(editor);
		if (!resolved) return false;
		this.cancelShow();
		this.show(resolved.url, resolved.rect);
		return true;
	}

	private resolveAtEditorCursor(editor: Editor): { url: string; rect: DOMRect } | null {
		const cursor = editor.getCursor();
		const raw = findLinkAtOffset(editor.getLine(cursor.line), cursor.ch);
		if (!raw) return null;

		const url = this.normalize(raw);
		if (!url) return null;
		try {
			if (isHostBlocked(new URL(url).hostname, this.plugin.blockedHosts)) return null;
		} catch {
			return null;
		}

		// anchor the popover at the cursor's screen position
		let rect = new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
		const view = (editor as unknown as { cm?: EditorView }).cm;
		if (view) {
			const pos = Math.min(
				view.state.doc.line(cursor.line + 1).from + cursor.ch,
				view.state.doc.length
			);
			const coords = view.coordsAtPos(pos);
			if (coords) {
				rect = new DOMRect(
					coords.left,
					coords.top,
					coords.right - coords.left,
					coords.bottom - coords.top
				);
			}
		}
		return { url, rect };
	}

	onKeyDown(evt: KeyboardEvent): void {
		this.heldKeys.add(evt.key);
		if (evt.key === "Escape") {
			this.hide(); // Escape always closes, in every mode
			return;
		}
		// wheel events over a webview go to the guest page, not the host DOM, so
		// zoom needs a shield to intercept the wheel while the zoom key is held
		if (this.isZoomKey(evt.key)) this.addZoomShield();
	}

	onKeyUp(evt: KeyboardEvent): void {
		this.heldKeys.delete(evt.key);
		if (this.isZoomKey(evt.key) && !this.zoomKeyHeld()) this.removeZoomShield();

		const { settings } = this.plugin;
		if (!settings.closeOnModifierRelease || settings.modifiers.length === 0) return;
		if (!modifiersHeld(evt, settings.modifiers)) {
			this.cancelShow();
			this.hide();
		}
	}

	onWindowBlur(): void {
		// alt-tabbing away can eat keyup events and leave phantom held keys
		this.heldKeys.clear();
		this.removeZoomShield();
	}

	onMouseDown(evt: MouseEvent): void {
		if (!this.popoverEl) return;
		const inside = evt.target instanceof Node && this.popoverEl.contains(evt.target);
		// mouse back/forward buttons: inside they drive the preview's history
		// (suppress Obsidian's note navigation), outside they are note
		// navigation and must not count as a dismissal click
		if (evt.button === 3 || evt.button === 4) {
			if (inside && this.renderer?.navigation) {
				evt.preventDefault();
				evt.stopPropagation();
			}
			return;
		}
		if (inside) return;
		this.hide(); // click anywhere outside closes (the designated dismissal in sticky mode)
	}

	/** capture-phase pointerup/mouseup for mouse back/forward buttons over the
	 *  popover's host surfaces; navigation triggers once, on pointerup */
	onAuxPointer(evt: MouseEvent, navigate: boolean): void {
		if (evt.button !== 3 && evt.button !== 4) return;
		const nav = this.renderer?.navigation;
		if (!this.popoverEl || !nav) return;
		if (!(evt.target instanceof Node) || !this.popoverEl.contains(evt.target)) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (!navigate) return;
		if (evt.button === 3) nav.back();
		else nav.forward();
	}

	onWheel(evt: WheelEvent): void {
		// scrolling the note under an open popover leaves it floating over stale
		// content, so close; scrolling inside the popover is the popover's business
		if (!this.popoverEl) return;
		if (evt.target instanceof Node && this.popoverEl.contains(evt.target)) return;
		this.hide();
	}

	// ---- link resolution ----

	/**
	 * Extract an external URL from the hovered element, covering all three
	 * view modes:
	 *
	 * - Reading mode renders real anchors; read the raw href attribute rather
	 *   than anchor.href, because scheme-less links like [site](www.foo.com)
	 *   resolve against the app origin ("app://obsidian.md/www.foo.com").
	 *   Anchors marked internal-link belong to core Page Preview and are
	 *   never touched.
	 * - Source mode and live preview are CodeMirror: posAtCoords maps the
	 *   mouse position to a document offset and the containing line is
	 *   scanned for a link covering it. This handles live preview's folded
	 *   [text](url) links (the URL never exists in the DOM) and plain
	 *   untokenized text alike.
	 */
	private resolveLink(el: Element, evt: MouseEvent): { url: string; anchor: HTMLElement } | null {
		const anchor = el.closest("a");
		if (anchor instanceof HTMLAnchorElement) {
			if (anchor.classList.contains("internal-link")) return null;
			const url = this.normalize(anchor.getAttribute("href") ?? "");
			return url ? { url, anchor } : null;
		}

		return this.resolveLinkInEditor(el, evt);
	}

	private resolveLinkInEditor(
		el: Element,
		evt: MouseEvent
	): { url: string; anchor: HTMLElement } | null {
		const editorEl = el.closest(".cm-editor");
		if (!(editorEl instanceof HTMLElement)) return null;

		const view = EditorView.findFromDOM(editorEl);
		if (!view) return null;

		const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY });
		if (pos === null) return null;

		const line = view.state.doc.lineAt(pos);
		const rawLink = findLinkAtOffset(line.text, pos - line.from);
		if (!rawLink) return null;

		const url = this.normalize(rawLink);
		if (!url) return null;

		const token = el.closest(".cm-url, .cm-link, .cm-underline");
		const anchorEl =
			token instanceof HTMLElement ? token : el instanceof HTMLElement ? el : editorEl;
		return { url, anchor: anchorEl };
	}

	private normalize(raw: string): string | null {
		return normalizeUrl(raw, (target) => this.isVaultPath(target));
	}

	/** resolve scheme-less targets against the vault so notes like
	 *  "meeting.notes" aren't mistaken for web domains */
	private isVaultPath(target: string): boolean {
		try {
			const decoded = decodeURIComponent(target);
			return this.plugin.app.metadataCache.getFirstLinkpathDest(decoded, "") !== null;
		} catch {
			return false;
		}
	}

	// ---- show/hide lifecycle ----

	private scheduleShow(url: string, anchor: HTMLElement): void {
		this.cancelShow();

		const { hoverDelay, stillnessDelay } = this.plugin.settings;

		const fire = () => {
			this.showTimer = null;
			this.cancelShow(); // detach pending listeners
			this.show(url, anchor);
		};
		const arm = (delay: number) => {
			if (this.showTimer !== null) window.clearTimeout(this.showTimer);
			this.showTimer = window.setTimeout(fire, delay);
		};

		// pointer movement over the link restarts the countdown when stillness is on
		let moveListener: (() => void) | null = null;
		if (stillnessDelay > 0) {
			moveListener = () => arm(Math.max(stillnessDelay, 50));
			anchor.addEventListener("mousemove", moveListener);
		}

		const leaveListener = () => this.cancelShow();
		anchor.addEventListener("mouseleave", leaveListener, { once: true });

		this.pending = { url, anchor, moveListener, leaveListener };
		arm(hoverDelay);
	}

	private cancelShow(): void {
		if (this.showTimer !== null) {
			window.clearTimeout(this.showTimer);
			this.showTimer = null;
		}
		if (this.pending) {
			const { anchor, moveListener, leaveListener } = this.pending;
			if (moveListener) anchor.removeEventListener("mousemove", moveListener);
			anchor.removeEventListener("mouseleave", leaveListener);
			this.pending = null;
		}
	}

	/** anchor is the hovered link element, or a bare screen rect when opened
	 *  by the preview-link-under-cursor command */
	private show(url: string, anchor: HTMLElement | DOMRect): void {
		this.hide();
		this.currentUrl = url;
		this.displayedUrl = url;

		const { settings } = this.plugin;

		// the popover itself has visible overflow so the resize handles can
		// overhang its bounds (pointer overshoot still counts as "inside");
		// the frame provides the clipped, rounded visual box
		const popover = document.body.createDiv({ cls: "hoverlay-popover" });
		popover.style.width = px(settings.popoverWidth);
		popover.style.height = px(settings.popoverHeight);
		this.popoverEl = popover;

		const frame = popover.createDiv({ cls: "hoverlay-frame" });
		this.frameEl = frame;
		this.buildHeader(frame, url);
		const content = frame.createDiv({ cls: "hoverlay-content" });
		this.contentEl = content;

		const anchorRect =
			anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
		this.position(popover, anchorRect);
		this.addResizeHandles(popover);

		// zoom for the areas the host still sees directly (header, card mode);
		// the webview surface itself needs the shield (see onKeyDown)
		popover.addEventListener(
			"wheel",
			(evt: WheelEvent) => {
				if (!this.isZoomEvent(evt)) return;
				evt.preventDefault();
				evt.stopPropagation();
				this.adjustZoom(-Math.sign(evt.deltaY) * ZOOM_STEP);
			},
			{ passive: false }
		);

		if (settings.stickyMode === "hover") {
			popover.addEventListener("mouseenter", () => {
				this.cancelHide();
				this.suspendHoverUntil = 0;
			});
			popover.addEventListener("mouseleave", () => this.scheduleHide());
			if (anchor instanceof HTMLElement) {
				anchor.addEventListener("mouseleave", () => this.scheduleHide(), { once: true });
			}
		}

		// any renderer that can't show the page falls back to the metadata card
		const fallBackToCard = () => {
			if (this.currentUrl !== url || !this.contentEl) return;
			this.renderer?.dispose();
			this.renderer = renderCard(this.contentEl, url);
			this.updateNavState();
			this.updateMuteButton();
		};

		// per-domain override beats the global preview mode
		let host = "";
		try {
			host = new URL(url).hostname;
		} catch {
			// keep the global mode for unparseable hosts
		}
		const domainMode = host ? matchDomainMode(host, this.plugin.domainModeRules) : null;
		const mode = (domainMode === "embed" ? "auto" : domainMode) ?? settings.renderMode;

		// in auto mode, media links load the provider's embedded player: lighter
		// than the full page, and embed pages are designed for exactly this.
		// An explicit webview mode (global or per-domain) forces the raw page;
		// a per-domain "embed" entry forces the player even with embeds off.
		const embedWanted =
			domainMode === "embed" || (mode === "auto" && settings.enableEmbeds);
		const embedUrl = embedWanted ? resolveEmbedUrl(url) : null;
		const loadUrl = embedUrl ?? url;
		this.isEmbed = embedUrl !== null;
		// deliberate media playback should be audible; arbitrary pages stay
		// muted so hover previews never blare autoplay noise
		this.muted = !this.isEmbed;
		this.audioActive = false;

		// in-preview navigation: live-update the URL readout and history buttons.
		// The initial load is skipped so an embedded player keeps showing the
		// link's own URL rather than the internal player URL.
		const handleNavigate = (nextUrl: string) => {
			if (this.currentUrl !== url) return; // a different popover took over
			if (nextUrl === loadUrl) return;
			this.displayedUrl = nextUrl;
			this.headerUrlEl?.setText(nextUrl);
			this.headerUrlEl?.setAttribute("title", nextUrl);
			this.updateNavState();
		};

		if ((mode === "auto" || mode === "webview") && Platform.isDesktopApp) {
			this.renderer = renderWebview(content, loadUrl, {
				zoom: settings.webviewZoom,
				muted: this.muted,
				onFail: fallBackToCard,
				onNavigate: handleNavigate,
				onMediaPlaying: () => {
					if (this.currentUrl !== url) return;
					this.audioActive = true;
					this.updateMuteButton();
				},
			});
		} else if (mode === "reader") {
			this.renderer = renderReader(content, url, fallBackToCard);
		} else {
			this.renderer = renderCard(content, url);
		}
		this.updateNavState();
		this.updateMuteButton();

		// zoom key may already be held down when the popover opens
		if (this.zoomKeyHeld()) this.addZoomShield();
	}

	private togglePin(): void {
		this.pinned = !this.pinned;
		if (this.pinned) this.cancelHide();
		const button = this.pinBtnEl;
		if (!button) return;
		setIcon(button, this.pinned ? "pin-off" : "pin");
		button.toggleClass("is-active", this.pinned);
		const label = this.pinned
			? "Unpin (resume closing when the pointer leaves)"
			: "Pin (stay open until Escape or a click elsewhere)";
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
	}

	private toggleMute(): void {
		if (!this.renderer?.setMuted) return;
		this.muted = !this.muted;
		this.renderer.setMuted(this.muted);
		this.updateMuteButton();
	}

	/** embeds always show the speaker (media is the point); ordinary pages
	 *  only once the guest actually starts playing something */
	private updateMuteButton(): void {
		const button = this.muteBtnEl;
		if (!button) return;
		const relevant = !!this.renderer?.setMuted && (this.isEmbed || this.audioActive);
		button.toggleClass("is-hidden", !relevant);
		setIcon(button, this.muted ? "volume-x" : "volume-2");
		const label = this.muted ? "Unmute" : "Mute";
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
	}

	/** show the history buttons only for renderers that have a history, and
	 *  reflect whether each direction is currently possible */
	private updateNavState(): void {
		const nav = this.renderer?.navigation;
		this.navEl?.toggleClass("is-hidden", !nav);
		if (!nav) return;
		this.navBackEl?.toggleClass("is-disabled", !nav.canGoBack());
		this.navForwardEl?.toggleClass("is-disabled", !nav.canGoForward());
	}

	// ---- header bar ----

	private buildHeader(parent: HTMLElement, url: string): void {
		const header = parent.createDiv({ cls: "hoverlay-header" });

		const iconButton = (
			buttonParent: HTMLElement,
			icon: string,
			label: string,
			onClick: () => void
		): HTMLElement => {
			const button = buttonParent.createDiv({
				cls: "clickable-icon hoverlay-header-btn",
				attr: { "aria-label": label, title: label },
			});
			setIcon(button, icon);
			button.addEventListener("click", (evt) => {
				evt.stopPropagation();
				onClick();
			});
			return button;
		};

		// history buttons; hidden until a renderer with navigation is active
		const nav = header.createDiv({ cls: "hoverlay-header-nav is-hidden" });
		this.navEl = nav;
		this.navBackEl = iconButton(nav, "arrow-left", "Back", () =>
			this.renderer?.navigation?.back()
		);
		this.navForwardEl = iconButton(nav, "arrow-right", "Forward", () =>
			this.renderer?.navigation?.forward()
		);

		this.headerUrlEl = header.createDiv({
			cls: "hoverlay-header-url",
			text: url,
			attr: { title: url },
		});

		const actions = header.createDiv({ cls: "hoverlay-header-actions" });

		// transient zoom readout; appears on zoom changes, click resets to 100%
		this.zoomBadgeEl = actions.createDiv({
			cls: "hoverlay-zoom-badge",
			attr: { title: "Reset zoom to 100%", "aria-label": "Reset zoom to 100%" },
		});
		this.zoomBadgeEl.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.setZoomTo(1);
		});

		const addAction = (icon: string, label: string, onClick: () => void): HTMLElement =>
			iconButton(actions, icon, label, onClick);

		// per-popover pin: hover dismissal off until unpinned, Escape/X/click
		// outside still close. Redundant when the global mode is already sticky.
		if (this.plugin.settings.stickyMode === "hover") {
			this.pinBtnEl = addAction("pin", "Pin (stay open until Escape or a click elsewhere)", () =>
				this.togglePin()
			);
		}

		// mute toggle; hidden until audio is relevant (see updateMuteButton)
		this.muteBtnEl = addAction("volume-x", "Unmute", () => this.toggleMute());
		this.muteBtnEl.addClass("is-hidden");

		const maximizeBtn = addAction("maximize-2", "Maximize", () => {
			this.toggleMaximize();
			setIcon(maximizeBtn, this.maximized ? "minimize-2" : "maximize-2");
			const label = this.maximized ? "Restore size" : "Maximize";
			maximizeBtn.setAttribute("aria-label", label);
			maximizeBtn.setAttribute("title", label);
		});

		addAction("external-link", "Open in browser", () => {
			// after in-preview navigation, open the page being looked at now
			window.open(this.displayedUrl ?? url);
			this.hide();
		});

		addAction("x", "Close", () => this.hide());

		this.makeHeaderDraggable(header);
	}

	/** drag the header to reposition the popover; per-popup only, nothing persists */
	private makeHeaderDraggable(header: HTMLElement): void {
		header.addEventListener("pointerdown", (evt: PointerEvent) => {
			const popover = this.popoverEl;
			const frame = this.frameEl;
			if (!popover || !frame || this.maximized || evt.button !== 0) return;
			if (
				evt.target instanceof Element &&
				evt.target.closest(".hoverlay-header-btn, .hoverlay-zoom-badge")
			) {
				return;
			}
			evt.preventDefault();

			this.dragging = true; // suspends hover dismissal for the whole drag
			this.cancelHide();
			header.addClass("is-dragging");

			const offsetX = evt.clientX - popover.offsetLeft;
			const offsetY = evt.clientY - popover.offsetTop;
			// transparent shield so the webview doesn't swallow pointermove mid-drag
			const shield = frame.createDiv({ cls: "hoverlay-shield" });
			header.setPointerCapture(evt.pointerId);

			const onMove = (move: PointerEvent) => {
				const maxLeft = Math.max(
					VIEWPORT_MARGIN,
					window.innerWidth - popover.offsetWidth - VIEWPORT_MARGIN
				);
				const maxTop = Math.max(
					VIEWPORT_MARGIN,
					window.innerHeight - popover.offsetHeight - VIEWPORT_MARGIN
				);
				popover.style.left = px(clamp(move.clientX - offsetX, VIEWPORT_MARGIN, maxLeft));
				popover.style.top = px(clamp(move.clientY - offsetY, VIEWPORT_MARGIN, maxTop));
			};

			const onUp = () => {
				header.removeEventListener("pointermove", onMove);
				header.removeEventListener("pointerup", onUp);
				shield.remove();
				header.removeClass("is-dragging");
				this.dragging = false;
			};

			header.addEventListener("pointermove", onMove);
			header.addEventListener("pointerup", onUp);
		});
	}

	private toggleMaximize(): void {
		const popover = this.popoverEl;
		if (!popover) return;

		if (!this.maximized) {
			this.savedRect = {
				left: popover.style.left,
				top: popover.style.top,
				width: popover.style.width,
				height: popover.style.height,
			};
			popover.style.left = px(MAXIMIZE_MARGIN);
			popover.style.top = px(MAXIMIZE_MARGIN);
			popover.style.width = px(window.innerWidth - MAXIMIZE_MARGIN * 2);
			popover.style.height = px(window.innerHeight - MAXIMIZE_MARGIN * 2);
			this.maximized = true;
			this.cancelHide(); // maximized previews dismiss via Escape, X, or restore
		} else {
			if (this.savedRect) {
				popover.style.left = this.savedRect.left;
				popover.style.top = this.savedRect.top;
				popover.style.width = this.savedRect.width;
				popover.style.height = this.savedRect.height;
			}
			this.savedRect = null;
			this.maximized = false;
			// the cursor usually lands outside the restored rect; give the user a
			// moment to reach the popover before hover dismissal resumes
			this.suspendHoverUntil = Date.now() + RESTORE_HOVER_SUSPEND_MS;
		}
	}

	// ---- zoom ----

	/** the zoom key actually in effect: settings choice, migrated away from any
	 *  trigger-key conflict, or null when zoom is disabled (see resolveZoomModifier) */
	private activeZoomModifier(): ZoomModifier | null {
		const { zoomModifier, modifiers, closeOnModifierRelease } = this.plugin.settings;
		return resolveZoomModifier(zoomModifier, modifiers, closeOnModifierRelease);
	}

	private isZoomKey(key: string): boolean {
		switch (this.activeZoomModifier()) {
			case "ctrl":
				return key === "Control" || key === "Meta";
			case "alt":
				return key === "Alt";
			case "shift":
				return key === "Shift";
			case null:
				return false;
		}
	}

	private isZoomEvent(evt: WheelEvent): boolean {
		switch (this.activeZoomModifier()) {
			case "ctrl":
				return evt.ctrlKey || evt.metaKey;
			case "alt":
				return evt.altKey;
			case "shift":
				return evt.shiftKey;
			case null:
				return false;
		}
	}

	private zoomKeyHeld(): boolean {
		switch (this.activeZoomModifier()) {
			case "ctrl":
				return this.heldKeys.has("Control") || this.heldKeys.has("Meta");
			case "alt":
				return this.heldKeys.has("Alt");
			case "shift":
				return this.heldKeys.has("Shift");
			case null:
				return false;
		}
	}

	private addZoomShield(): void {
		if (this.zoomShieldEl || !this.contentEl || !this.renderer?.setZoom) return;
		const shield = this.contentEl.createDiv({ cls: "hoverlay-zoom-shield" });
		shield.addEventListener(
			"wheel",
			(evt: WheelEvent) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.adjustZoom(-Math.sign(evt.deltaY) * ZOOM_STEP);
			},
			{ passive: false }
		);
		this.zoomShieldEl = shield;
	}

	private removeZoomShield(): void {
		this.zoomShieldEl?.remove();
		this.zoomShieldEl = null;
	}

	private adjustZoom(delta: number): void {
		this.setZoomTo(this.plugin.settings.webviewZoom + delta);
	}

	private setZoomTo(value: number): void {
		if (!this.renderer?.setZoom) return; // current renderer doesn't zoom
		const { settings } = this.plugin;
		const zoom = Math.round(clamp(value, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
		if (zoom !== settings.webviewZoom) {
			settings.webviewZoom = zoom;
			void this.plugin.saveSettings();
			this.renderer.setZoom(zoom);
		}
		this.showZoomBadge(zoom); // show even when clamped, as feedback that the limit is hit
	}

	private showZoomBadge(zoom: number): void {
		const badge = this.zoomBadgeEl;
		if (!badge) return;
		badge.setText(`${Math.round(zoom * 100)}%`);
		badge.addClass("is-visible");
		if (this.zoomBadgeTimer !== null) window.clearTimeout(this.zoomBadgeTimer);
		this.zoomBadgeTimer = window.setTimeout(() => {
			this.zoomBadgeTimer = null;
			badge.removeClass("is-visible");
		}, 1600);
	}

	// ---- positioning / resizing ----

	private position(popover: HTMLElement, rect: DOMRect): void {
		const { settings } = this.plugin;

		let left = rect.left;
		let top = rect.bottom + VIEWPORT_MARGIN;

		if (left + settings.popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
			left = window.innerWidth - settings.popoverWidth - VIEWPORT_MARGIN;
		}
		if (top + settings.popoverHeight > window.innerHeight - VIEWPORT_MARGIN) {
			top = rect.top - settings.popoverHeight - VIEWPORT_MARGIN; // flip above the link
		}

		popover.style.left = px(Math.max(VIEWPORT_MARGIN, left));
		popover.style.top = px(Math.max(VIEWPORT_MARGIN, top));
	}

	private addResizeHandles(popover: HTMLElement): void {
		for (const { cls, edges } of RESIZE_HANDLES) {
			const handle = popover.createDiv({ cls: `hoverlay-resize hoverlay-resize-${cls}` });

			const setHighlight = (on: boolean) => {
				if (edges.left) popover.toggleClass("hoverlay-hl-left", on);
				if (edges.right) popover.toggleClass("hoverlay-hl-right", on);
				if (edges.top) popover.toggleClass("hoverlay-hl-top", on);
				if (edges.bottom) popover.toggleClass("hoverlay-hl-bottom", on);
			};

			handle.addEventListener("mouseenter", () => setHighlight(true));
			handle.addEventListener("mouseleave", () => {
				if (!this.resizing) setHighlight(false);
			});
			handle.addEventListener("pointerdown", (evt: PointerEvent) =>
				this.startResize(evt, handle, edges, setHighlight)
			);
		}
	}

	private startResize(
		evt: PointerEvent,
		handle: HTMLElement,
		edges: ResizeEdges,
		setHighlight: (on: boolean) => void
	): void {
		const popover = this.popoverEl;
		const frame = this.frameEl;
		if (!popover || !frame) return;

		evt.preventDefault();
		evt.stopPropagation();

		this.resizing = true; // suspends hover dismissal for the whole drag
		this.cancelHide();
		setHighlight(true);

		const startX = evt.clientX;
		const startY = evt.clientY;
		const startWidth = popover.offsetWidth;
		const startHeight = popover.offsetHeight;
		const startLeft = popover.offsetLeft;
		const startTop = popover.offsetTop;

		// transparent shield so the webview doesn't swallow pointermove mid-drag
		const shield = frame.createDiv({ cls: "hoverlay-shield" });
		handle.setPointerCapture(evt.pointerId);

		const onMove = (move: PointerEvent) => {
			const dx = move.clientX - startX;
			const dy = move.clientY - startY;

			if (edges.right) {
				const maxWidth = window.innerWidth - startLeft - VIEWPORT_MARGIN;
				popover.style.width = px(clamp(startWidth + dx, MIN_WIDTH, maxWidth));
			}
			if (edges.bottom) {
				const maxHeight = window.innerHeight - startTop - VIEWPORT_MARGIN;
				popover.style.height = px(clamp(startHeight + dy, MIN_HEIGHT, maxHeight));
			}
			if (edges.left) {
				// left edge moves the origin as well as the size
				const maxWidth = startLeft + startWidth - VIEWPORT_MARGIN;
				const width = clamp(startWidth - dx, MIN_WIDTH, maxWidth);
				popover.style.width = px(width);
				popover.style.left = px(startLeft + startWidth - width);
			}
			if (edges.top) {
				const maxHeight = startTop + startHeight - VIEWPORT_MARGIN;
				const height = clamp(startHeight - dy, MIN_HEIGHT, maxHeight);
				popover.style.height = px(height);
				popover.style.top = px(startTop + startHeight - height);
			}
		};

		const onUp = () => {
			handle.removeEventListener("pointermove", onMove);
			handle.removeEventListener("pointerup", onUp);
			shield.remove();
			this.resizing = false;
			setHighlight(false);
			if (this.plugin.settings.persistResize && !this.maximized) {
				this.plugin.settings.popoverWidth = popover.offsetWidth;
				this.plugin.settings.popoverHeight = popover.offsetHeight;
				void this.plugin.saveSettings();
			}
		};

		handle.addEventListener("pointermove", onMove);
		handle.addEventListener("pointerup", onUp);
	}

	// ---- timers / teardown ----

	private scheduleHide(): void {
		if (this.pinned) return; // pinned popovers close via Escape, X or click outside
		if (this.maximized) return; // see toggleMaximize: hover dismissal is suspended
		if (this.resizing || this.dragging) return; // never close mid-drag
		this.cancelHide();
		// while the post-restore grace is active, defer instead of skipping so an
		// untouched popover still closes eventually
		const graceRemaining = Math.max(0, this.suspendHoverUntil - Date.now());
		this.hideTimer = window.setTimeout(() => {
			this.hideTimer = null;
			this.hide();
		}, this.plugin.settings.hideDelay + graceRemaining);
	}

	private cancelHide(): void {
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}

	hide(): void {
		this.cancelHide();
		this.removeZoomShield();
		if (this.zoomBadgeTimer !== null) {
			window.clearTimeout(this.zoomBadgeTimer);
			this.zoomBadgeTimer = null;
		}
		this.zoomBadgeEl = null;
		this.renderer?.dispose();
		this.renderer = null;
		this.popoverEl?.remove();
		this.popoverEl = null;
		this.frameEl = null;
		this.contentEl = null;
		this.currentUrl = null;
		this.displayedUrl = null;
		this.headerUrlEl = null;
		this.navEl = null;
		this.navBackEl = null;
		this.navForwardEl = null;
		this.muteBtnEl = null;
		this.pinBtnEl = null;
		this.pinned = false;
		this.isEmbed = false;
		this.audioActive = false;
		this.maximized = false;
		this.savedRect = null;
		this.resizing = false;
		this.dragging = false;
		this.suspendHoverUntil = 0;
	}

	destroy(): void {
		this.cancelShow();
		this.hide();
	}
}
