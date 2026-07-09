/**
 * Desktop renderer: Electron <webview>.
 *
 * This is the load-bearing design decision of the whole plugin. An <iframe>
 * is refused by any site that sends X-Frame-Options or CSP frame-ancestors,
 * which is most of the modern web; that refusal is silent (onerror does not
 * fire), which is why iframe-based preview plugins appear broken on those
 * sites. A webview is a separate guest page doing top-level navigation, so
 * those headers do not apply. Same approach as Canvas web embeds and the
 * Surfing plugin.
 *
 * Zoom is implemented host-side with a CSS transform (render the guest at
 * 100/zoom percent size, scale down by zoom) instead of the guest-side
 * setZoomFactor API, which proved unreliable. The transform needs no guest
 * cooperation and applies instantly, before the page has even loaded.
 */
import {
	GUEST_POINTER_MSG,
	NAV_BACK_MSG,
	NAV_FORWARD_MSG,
	applyVolumeJs,
	guestBootstrapJs,
	parseGuestKeyMessage,
	scrollbarCss,
} from "../guest-scripts";
import type { GuestKeyEvent } from "../guest-scripts";
import type { RendererHandle } from "./types";

interface ElectronWebview extends HTMLElement {
	setAudioMuted(muted: boolean): void;
	stop(): void;
	insertCSS(css: string): Promise<string>;
	executeJavaScript(code: string): Promise<unknown>;
	goBack(): void;
	goForward(): void;
	canGoBack(): boolean;
	canGoForward(): boolean;
}

/** guest scrollbar theming, with the vault's scrollbar variables resolved
 *  at render time so theme switches apply to the next preview */
function themedScrollbarCss(doc: Document): string {
	const style = getComputedStyle(doc.body);
	const read = (name: string, fallback: string) =>
		style.getPropertyValue(name).trim() || fallback;
	const thumb = read("--scrollbar-thumb-bg", "rgba(0, 0, 0, 0.2)");
	return scrollbarCss({
		bg: read("--scrollbar-bg", "rgba(0, 0, 0, 0.05)"),
		thumb,
		active: read("--scrollbar-active-thumb-bg", thumb),
	});
}

export interface WebviewOptions {
	zoom: number;
	muted: boolean;
	/** initial media volume, 0..1 */
	volume: number;
	/** Electron session partition; previews never share Obsidian's default session */
	partition: string;
	/** Referer for the load; embeds require one (see EMBED_REFERRER) */
	referrer?: string;
	onFail: () => void;
	onNavigate: (url: string) => void;
	/** fired when the guest starts playing media (also fires for muted media) */
	onMediaPlaying: () => void;
	/** the guest gained or lost keyboard focus; whether to keep or bounce it
	 *  is the manager's call (via the handle's blurGuest) */
	onGuestFocus: (focused: boolean) => void;
	/** the guest saw a mousedown: the pointer really is inside the preview */
	onGuestPointer: () => void;
	/** Escape/modifier key events forwarded from the guest bootstrap */
	onGuestKey: (event: GuestKeyEvent) => void;
}

export function renderWebview(
	container: HTMLElement,
	url: string,
	options: WebviewOptions
): RendererHandle {
	const { zoom, muted, volume, partition, referrer, onFail, onNavigate, onMediaPlaying } =
		options;
	const { onGuestFocus, onGuestPointer, onGuestKey } = options;
	const frame = container.createDiv({ cls: "hoverlay-webview-frame" });
	// the popover may live in a pop-out window; build in its document
	const doc = container.ownerDocument;
	const webview = doc.createElement("webview") as ElectronWebview;
	// the partition is fixed at first navigation, so it must precede src
	webview.setAttribute("partition", partition);
	if (referrer) webview.setAttribute("httpreferrer", referrer);
	webview.setAttribute("src", url);
	webview.classList.add("hoverlay-webview");

	const applyZoom = (factor: number) => {
		const percent = 100 / factor;
		webview.style.width = `${percent}%`;
		webview.style.height = `${percent}%`;
		webview.style.transform = `scale(${factor})`;
	};
	applyZoom(zoom);

	// themed spinner over the webview until the guest page has rendered
	const loading = container.createDiv({ cls: "hoverlay-loading" });
	loading.createDiv({ cls: "hoverlay-spinner" });

	const navigation = {
		back: () => {
			try {
				webview.goBack();
			} catch {
				// guest may be gone
			}
		},
		forward: () => {
			try {
				webview.goForward();
			} catch {
				// guest may be gone
			}
		},
		canGoBack: () => {
			try {
				return webview.canGoBack();
			} catch {
				return false;
			}
		},
		canGoForward: () => {
			try {
				return webview.canGoForward();
			} catch {
				return false;
			}
		},
	};

	let ready = false;
	let currentMuted = muted;
	let currentVolume = volume;

	webview.addEventListener("dom-ready", () => {
		ready = true;
		loading.remove();
		try {
			webview.setAudioMuted(currentMuted);
			void webview.insertCSS(themedScrollbarCss(doc));
			void webview.executeJavaScript(guestBootstrapJs(currentVolume));
		} catch {
			// muting, scrollbar theming and the guest bootstrap are all optional
		}
	});

	webview.addEventListener("did-navigate", (event: unknown) => {
		const nextUrl = (event as { url?: string })?.url;
		if (nextUrl) onNavigate(nextUrl);
	});

	webview.addEventListener("did-navigate-in-page", (event: unknown) => {
		const detail = event as { url?: string; isMainFrame?: boolean };
		if (detail?.url && detail.isMainFrame !== false) onNavigate(detail.url);
	});

	webview.addEventListener("console-message", (event: unknown) => {
		const message = (event as { message?: string })?.message;
		if (!message) return;
		if (message === NAV_BACK_MSG) navigation.back();
		else if (message === NAV_FORWARD_MSG) navigation.forward();
		else if (message === GUEST_POINTER_MSG) onGuestPointer();
		else {
			const key = parseGuestKeyMessage(message);
			if (key) onGuestKey(key);
		}
	});

	webview.addEventListener("media-started-playing", () => onMediaPlaying());

	// a guest player's own fullscreen button fullscreens the whole window;
	// track it so dispose can restore the window if the popover closes while
	// the guest is still fullscreen (otherwise Obsidian is stuck fullscreen)
	let guestFullscreen = false;
	webview.addEventListener("enter-html-full-screen", () => {
		guestFullscreen = true;
	});
	webview.addEventListener("leave-html-full-screen", () => {
		guestFullscreen = false;
	});

	// the guest may hold keyboard focus: clicking into the preview is how
	// logins get typed. While it does, the host receives no key events, so
	// the guest bootstrap forwards Escape and the modifier keys back over
	// the console-message channel, and the manager is told about focus
	// changes so it can suspend hover dismissal mid-interaction and bounce
	// focus the guest grabbed for itself (via blurGuest below).
	webview.addEventListener("focus", () => onGuestFocus(true));
	webview.addEventListener("blur", () => onGuestFocus(false));

	webview.addEventListener("did-fail-load", (event: unknown) => {
		// errorCode -3 is ERR_ABORTED, fired benignly on rapid teardown/redirects
		const code = (event as { errorCode?: number })?.errorCode;
		if (code !== undefined && code !== -3) onFail();
	});

	frame.appendChild(webview);

	return {
		blurGuest: () => {
			try {
				webview.blur();
			} catch {
				// guest may be gone
			}
		},
		dispose: () => {
			loading.remove();
			const fullscreenEl = doc.fullscreenElement;
			if (guestFullscreen || (fullscreenEl && frame.contains(fullscreenEl))) {
				void doc.exitFullscreen().catch(() => {});
			}
			try {
				webview.stop();
			} catch {
				// guest may already be destroyed
			}
			frame.remove();
		},
		setZoom: applyZoom,
		setMuted: (nextMuted: boolean) => {
			currentMuted = nextMuted;
			if (!ready) return; // dom-ready applies the pending state
			try {
				webview.setAudioMuted(nextMuted);
			} catch {
				// guest may be mid-navigation
			}
		},
		setVolume: (nextVolume: number) => {
			currentVolume = Math.min(1, Math.max(0, nextVolume));
			if (!ready) return; // dom-ready applies the pending state
			try {
				void webview.executeJavaScript(applyVolumeJs(currentVolume));
			} catch {
				// guest may be mid-navigation
			}
		},
		navigation,
	};
}
