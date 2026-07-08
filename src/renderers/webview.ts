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

/**
 * Mouse back/forward buttons pressed over the guest never reach the host as
 * events, so a tiny inert listener inside the guest reports them over the
 * console-message channel (the only guest-to-host channel that needs no
 * preload script).
 */
const NAV_BACK_MSG = "__hoverlay:navigate-back__";
const NAV_FORWARD_MSG = "__hoverlay:navigate-forward__";
const MOUSE_NAV_BRIDGE =
	`window.addEventListener("mouseup", (e) => {` +
	` if (e.button === 3) console.log("${NAV_BACK_MSG}");` +
	` else if (e.button === 4) console.log("${NAV_FORWARD_MSG}");` +
	` }, true); undefined;`;

/** guest pages keep their own scrollbars; theme them with the vault's
 *  scrollbar variables, resolved at render time so theme switches apply */
function themedScrollbarCss(): string {
	const style = getComputedStyle(document.body);
	const read = (name: string, fallback: string) =>
		style.getPropertyValue(name).trim() || fallback;
	const bg = read("--scrollbar-bg", "rgba(0, 0, 0, 0.05)");
	const thumb = read("--scrollbar-thumb-bg", "rgba(0, 0, 0, 0.2)");
	const active = read("--scrollbar-active-thumb-bg", thumb);
	return `
		::-webkit-scrollbar { width: 12px; height: 12px; background-color: transparent; }
		::-webkit-scrollbar-track { background-color: ${bg}; }
		::-webkit-scrollbar-thumb { background-color: ${thumb}; border-radius: 12px; background-clip: padding-box; border: 3px solid transparent; }
		::-webkit-scrollbar-thumb:hover, ::-webkit-scrollbar-thumb:active { background-color: ${active}; }
		::-webkit-scrollbar-corner { background: transparent; }
	`;
}

export function renderWebview(
	container: HTMLElement,
	url: string,
	zoom: number,
	muted: boolean,
	onFail: () => void,
	onNavigate: (url: string) => void
): RendererHandle {
	const frame = container.createDiv({ cls: "hoverlay-webview-frame" });
	const webview = document.createElement("webview") as ElectronWebview;
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

	webview.addEventListener("dom-ready", () => {
		ready = true;
		loading.remove();
		try {
			webview.setAudioMuted(currentMuted);
			void webview.insertCSS(themedScrollbarCss());
			void webview.executeJavaScript(MOUSE_NAV_BRIDGE);
		} catch {
			// muting, scrollbar theming and the nav bridge are all optional
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
		if (message === NAV_BACK_MSG) navigation.back();
		else if (message === NAV_FORWARD_MSG) navigation.forward();
	});

	// keep keyboard focus host-side: if the guest page grabs focus (a click
	// into the preview), the host stops receiving key events and Escape,
	// modifier tracking and zoom all silently break. A hover preview is
	// read-only, so bounce focus straight back.
	webview.addEventListener("focus", () => {
		window.setTimeout(() => webview.blur(), 0);
	});

	webview.addEventListener("did-fail-load", (event: unknown) => {
		// errorCode -3 is ERR_ABORTED, fired benignly on rapid teardown/redirects
		const code = (event as { errorCode?: number })?.errorCode;
		if (code !== undefined && code !== -3) onFail();
	});

	frame.appendChild(webview);

	return {
		dispose: () => {
			loading.remove();
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
		navigation,
	};
}
