import { Platform, setIcon } from "obsidian";
import type { Editor } from "obsidian";
import type HoverlayPlugin from "./main";
import { modifiersHeld, isHostBlocked, resolveZoomModifier } from "./rules";
import type { ZoomModifier } from "./rules";
import { normalizeUrl } from "./links";
import { resolveLinkAt, resolveEditorCursorLink } from "./link-resolver";
import type { ResolvedLink } from "./link-resolver";
import { choosePresentation } from "./presentation";
import {
	RESIZE_HANDLES,
	ZOOM_STEP,
	clampZoom,
	dragPosition,
	flyoutLeft,
	maximizedRect,
	popoverPosition,
	resizeRect,
} from "./geometry";
import type { EdgeSet, Size } from "./geometry";
import { renderWebview } from "./renderers/webview";
import { renderCard } from "./renderers/card";
import { renderReader } from "./renderers/reader";
import type { RendererHandle } from "./renderers/types";

/** hover dismissal grace after restoring from maximize, so the popover
 *  doesn't instantly close when the cursor lands outside the restored rect */
const RESTORE_HOVER_SUSPEND_MS = 1500;
/** re-resolving the same hovered element within this window reuses the last
 *  result (editor scans force layout reads on every mouseover otherwise) */
const RESOLVE_CACHE_MS = 250;

const px = (value: number) => `${value}px`;

const viewportSize = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

function iconButton(
	parent: HTMLElement,
	icon: string,
	label: string,
	onClick: () => void
): HTMLElement {
	const button = parent.createDiv({
		cls: "clickable-icon hoverlay-header-btn",
		attr: { "aria-label": label, title: label },
	});
	setIcon(button, icon);
	button.addEventListener("click", (evt) => {
		evt.stopPropagation();
		onClick();
	});
	return button;
}

function setButtonState(button: HTMLElement, icon: string, label: string): void {
	setIcon(button, icon);
	button.setAttribute("aria-label", label);
	button.setAttribute("title", label);
}

interface PendingHover {
	url: string;
	anchor: HTMLElement;
	moveListener: (() => void) | null;
	leaveListener: () => void;
}

/**
 * Owns the single popover instance: hover intake, show/hide lifecycle and
 * the wiring between header controls, renderers and settings. Decisions
 * live in the pure modules (links, rules, presentation, geometry); this
 * class reads DOM state, calls them and applies the results.
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
	private volumeFlyoutEl: HTMLElement | null = null;
	private volumeFlyoutTimer: number | null = null;
	private pinBtnEl: HTMLElement | null = null;
	private pinned = false;
	private heldKeys = new Set<string>();
	private lastResolveEl: Element | null = null;
	private lastResolveTime = 0;
	private lastResolveResult: ResolvedLink | null = null;

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

		const link = this.resolveLinkCached(target, evt);

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
		if (this.isBlocked(url)) return;

		this.scheduleShow(url, anchor);
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
		const resolved = resolveEditorCursorLink(editor, (raw) => this.normalize(raw));
		if (!resolved || this.isBlocked(resolved.url)) return null;
		return resolved;
	}

	// ---- link resolution ----

	private resolveLinkCached(target: Element, evt: MouseEvent): ResolvedLink | null {
		const now = performance.now();
		if (target === this.lastResolveEl && now - this.lastResolveTime < RESOLVE_CACHE_MS) {
			return this.lastResolveResult;
		}
		const link = resolveLinkAt(target, evt, (raw) => this.normalize(raw));
		this.lastResolveEl = target;
		this.lastResolveTime = now;
		this.lastResolveResult = link;
		return link;
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

	private isBlocked(url: string): boolean {
		try {
			return isHostBlocked(new URL(url).hostname, this.plugin.blockedHosts);
		} catch {
			return true; // unparseable even after normalization
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

		const popover = this.buildShell(url);
		this.placePopover(popover, anchor);
		this.addResizeHandles(popover);
		this.attachZoomWheel(popover);
		this.attachHoverDismissal(popover, anchor);
		this.mountRenderer(url);

		// zoom key may already be held down when the popover opens
		if (this.zoomKeyHeld()) this.addZoomShield();
	}

	/** popover, frame, header and content elements, at the configured size */
	private buildShell(url: string): HTMLElement {
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
		this.contentEl = frame.createDiv({ cls: "hoverlay-content" });
		return popover;
	}

	private placePopover(popover: HTMLElement, anchor: HTMLElement | DOMRect): void {
		const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
		const { settings } = this.plugin;
		const pos = popoverPosition(
			{ left: rect.left, top: rect.top, bottom: rect.bottom },
			{ width: settings.popoverWidth, height: settings.popoverHeight },
			viewportSize()
		);
		popover.style.left = px(pos.left);
		popover.style.top = px(pos.top);
	}

	/** zoom for the areas the host still sees directly (header, card mode);
	 *  the webview surface itself needs the shield (see onKeyDown) */
	private attachZoomWheel(popover: HTMLElement): void {
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
	}

	private attachHoverDismissal(popover: HTMLElement, anchor: HTMLElement | DOMRect): void {
		if (this.plugin.settings.stickyMode !== "hover") return;
		popover.addEventListener("mouseenter", () => {
			this.cancelHide();
			this.suspendHoverUntil = 0;
		});
		popover.addEventListener("mouseleave", () => this.scheduleHide());
		if (anchor instanceof HTMLElement) {
			anchor.addEventListener("mouseleave", () => this.scheduleHide(), { once: true });
		}
	}

	/** renderer selection (via the pure presentation module), fallback and
	 *  navigation wiring */
	private mountRenderer(url: string): void {
		const content = this.contentEl;
		if (!content) return;
		const { settings } = this.plugin;

		const presentation = choosePresentation({
			url,
			renderMode: settings.renderMode,
			enableEmbeds: settings.enableEmbeds,
			domainRules: this.plugin.domainModeRules,
			isDesktop: Platform.isDesktopApp,
		});
		const loadUrl = presentation.loadUrl;
		this.isEmbed = presentation.isEmbed;
		// deliberate media playback should be audible; arbitrary pages stay
		// muted so hover previews never blare autoplay noise
		this.muted = !this.isEmbed;
		this.audioActive = false;

		// any renderer that can't show the page falls back to the metadata card
		const fallBackToCard = () => {
			if (this.currentUrl !== url || !this.contentEl) return;
			this.renderer?.dispose();
			this.renderer = renderCard(this.contentEl, url);
			this.updateNavState();
			this.updateMuteButton();
		};

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

		if (presentation.kind === "webview") {
			this.renderer = renderWebview(content, loadUrl, {
				zoom: settings.webviewZoom,
				muted: this.muted,
				volume: settings.mediaVolume,
				onFail: fallBackToCard,
				onNavigate: handleNavigate,
				onMediaPlaying: () => {
					if (this.currentUrl !== url) return;
					this.audioActive = true;
					this.updateMuteButton();
				},
			});
		} else if (presentation.kind === "reader") {
			this.renderer = renderReader(content, url, fallBackToCard);
		} else {
			this.renderer = renderCard(content, url);
		}
		this.updateNavState();
		this.updateMuteButton();
	}

	// ---- header bar ----

	private buildHeader(parent: HTMLElement, url: string): void {
		const header = parent.createDiv({ cls: "hoverlay-header" });

		this.buildNavButtons(header);

		this.headerUrlEl = header.createDiv({
			cls: "hoverlay-header-url",
			text: url,
			attr: { title: url },
		});

		this.buildActionButtons(header, parent, url);
		this.makeHeaderDraggable(header);
	}

	/** history buttons; hidden until a renderer with navigation is active */
	private buildNavButtons(header: HTMLElement): void {
		const nav = header.createDiv({ cls: "hoverlay-header-nav is-hidden" });
		this.navEl = nav;
		this.navBackEl = iconButton(nav, "arrow-left", "Back", () =>
			this.renderer?.navigation?.back()
		);
		this.navForwardEl = iconButton(nav, "arrow-right", "Forward", () =>
			this.renderer?.navigation?.forward()
		);
	}

	private buildActionButtons(header: HTMLElement, frame: HTMLElement, url: string): void {
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

		// per-popover pin: hover dismissal off until unpinned, Escape/X/click
		// outside still close. Redundant when the global mode is already sticky.
		if (this.plugin.settings.stickyMode === "hover") {
			this.pinBtnEl = iconButton(
				actions,
				"pin",
				"Pin (stay open until Escape or a click elsewhere)",
				() => this.togglePin()
			);
		}

		// mute toggle; hidden until audio is relevant (see updateMuteButton)
		this.muteBtnEl = iconButton(actions, "volume-x", "Unmute", () => this.toggleMute());
		this.muteBtnEl.addClass("is-hidden");
		this.buildVolumeFlyout(frame, this.muteBtnEl);

		const maximizeBtn = iconButton(actions, "maximize-2", "Maximize", () => {
			this.toggleMaximize();
			setButtonState(
				maximizeBtn,
				this.maximized ? "minimize-2" : "maximize-2",
				this.maximized ? "Restore size" : "Maximize"
			);
		});

		iconButton(actions, "external-link", "Open in browser", () => {
			// after in-preview navigation, open the page being looked at now
			window.open(this.displayedUrl ?? url);
			this.hide();
		});

		iconButton(actions, "x", "Close", () => this.hide());
	}

	/** volume slider flyout, shown while hovering the speaker button or the
	 *  flyout itself; the value is a single global setting, not per-site */
	private buildVolumeFlyout(frame: HTMLElement, muteBtn: HTMLElement): void {
		const flyout = frame.createDiv({ cls: "hoverlay-volume-flyout is-hidden" });
		this.volumeFlyoutEl = flyout;

		// the visible control is drawn with plain divs so no app or theme
		// range-input styling can interfere; the input below is only an
		// invisible interaction layer
		const track = flyout.createDiv({ cls: "hoverlay-volume-track" });
		track.createDiv({ cls: "hoverlay-volume-fill" });
		track.createDiv({ cls: "hoverlay-volume-thumb" });

		const slider = flyout.createEl("input", {
			cls: "hoverlay-volume-slider",
			attr: {
				type: "range",
				min: "0",
				max: "100",
				step: "5",
				"aria-label": "Media volume",
			},
		});
		slider.value = String(Math.round(this.plugin.settings.mediaVolume * 100));

		// drives the fill height and thumb position of the drawn control
		const updateFill = () =>
			flyout.style.setProperty("--hoverlay-volume-fill", `${slider.value}%`);
		updateFill();

		slider.addEventListener("input", () => {
			updateFill();
			const volume = Number(slider.value) / 100;
			this.plugin.settings.mediaVolume = volume;
			this.renderer?.setVolume?.(volume);
			// adjusting volume is an intent to hear it
			if (this.muted && volume > 0) {
				this.muted = false;
				this.renderer?.setMuted?.(false);
			}
			this.updateMuteButton();
		});
		// persist once per adjustment, not on every drag tick
		slider.addEventListener("change", () => void this.plugin.saveSettings());

		const showFlyout = () => {
			if (this.volumeFlyoutTimer !== null) {
				window.clearTimeout(this.volumeFlyoutTimer);
				this.volumeFlyoutTimer = null;
			}
			if (!this.renderer?.setVolume || muteBtn.hasClass("is-hidden")) return;
			flyout.removeClass("is-hidden");
			// anchor centered under the speaker button; its position shifts as
			// header buttons come and go, so compute at show time
			const frameRect = frame.getBoundingClientRect();
			const buttonRect = muteBtn.getBoundingClientRect();
			flyout.style.left = px(
				flyoutLeft(
					buttonRect.left - frameRect.left,
					buttonRect.width,
					flyout.offsetWidth,
					frame.clientWidth
				)
			);
		};
		const scheduleFlyoutHide = () => {
			if (this.volumeFlyoutTimer !== null) window.clearTimeout(this.volumeFlyoutTimer);
			this.volumeFlyoutTimer = window.setTimeout(() => {
				this.volumeFlyoutTimer = null;
				flyout.addClass("is-hidden");
			}, 250);
		};

		muteBtn.addEventListener("mouseenter", showFlyout);
		muteBtn.addEventListener("mouseleave", scheduleFlyoutHide);
		flyout.addEventListener("mouseenter", showFlyout);
		flyout.addEventListener("mouseleave", scheduleFlyoutHide);
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

			const grabOffset = {
				x: evt.clientX - popover.offsetLeft,
				y: evt.clientY - popover.offsetTop,
			};
			// transparent shield so the webview doesn't swallow pointermove mid-drag
			const shield = frame.createDiv({ cls: "hoverlay-shield" });
			header.setPointerCapture(evt.pointerId);

			const onMove = (move: PointerEvent) => {
				const pos = dragPosition(
					{ x: move.clientX, y: move.clientY },
					grabOffset,
					{ width: popover.offsetWidth, height: popover.offsetHeight },
					viewportSize()
				);
				popover.style.left = px(pos.left);
				popover.style.top = px(pos.top);
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

	// ---- header controls ----

	private togglePin(): void {
		this.pinned = !this.pinned;
		if (this.pinned) this.cancelHide();
		const button = this.pinBtnEl;
		if (!button) return;
		button.toggleClass("is-active", this.pinned);
		setButtonState(
			button,
			this.pinned ? "pin-off" : "pin",
			this.pinned
				? "Unpin (resume closing when the pointer leaves)"
				: "Pin (stay open until Escape or a click elsewhere)"
		);
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
		const icon = this.muted
			? "volume-x"
			: this.plugin.settings.mediaVolume < 0.5
				? "volume-1"
				: "volume-2";
		setButtonState(button, icon, this.muted ? "Unmute" : "Mute");
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
			const rect = maximizedRect(viewportSize());
			popover.style.left = px(rect.left);
			popover.style.top = px(rect.top);
			popover.style.width = px(rect.width);
			popover.style.height = px(rect.height);
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
		const zoom = clampZoom(value);
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

	// ---- resizing ----

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
		edges: EdgeSet,
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

		const startPointer = { x: evt.clientX, y: evt.clientY };
		const startRect = {
			left: popover.offsetLeft,
			top: popover.offsetTop,
			width: popover.offsetWidth,
			height: popover.offsetHeight,
		};

		// transparent shield so the webview doesn't swallow pointermove mid-drag
		const shield = frame.createDiv({ cls: "hoverlay-shield" });
		handle.setPointerCapture(evt.pointerId);

		const onMove = (move: PointerEvent) => {
			const next = resizeRect(
				edges,
				startRect,
				{ x: move.clientX - startPointer.x, y: move.clientY - startPointer.y },
				viewportSize()
			);
			popover.style.left = px(next.left);
			popover.style.top = px(next.top);
			popover.style.width = px(next.width);
			popover.style.height = px(next.height);
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
		if (this.volumeFlyoutTimer !== null) {
			window.clearTimeout(this.volumeFlyoutTimer);
			this.volumeFlyoutTimer = null;
		}
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
		this.zoomBadgeEl = null;
		this.muteBtnEl = null;
		this.pinBtnEl = null;
		this.volumeFlyoutEl = null;
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
