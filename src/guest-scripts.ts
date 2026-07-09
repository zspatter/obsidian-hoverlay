/**
 * Builders for everything injected into the webview guest: the mouse-nav
 * bridge, the volume hook and the themed scrollbar CSS. Pure string
 * functions; the renderer supplies live values (theme colors, volume).
 */

export const NAV_BACK_MSG = "__hoverlay:navigate-back__";
export const NAV_FORWARD_MSG = "__hoverlay:navigate-forward__";

/** the guest saw a mousedown: proof the pointer is really inside the preview,
 *  which is what legitimizes the focus grab that follows a click (a real
 *  pointer over the webview surface fires no host events at all) */
export const GUEST_POINTER_MSG = "__hoverlay:guest-pointer__";

/** key events forwarded from the guest look like __hoverlay:key-down:Control__ */
export const KEY_MSG_PREFIX = "__hoverlay:key-";

export type GuestKeyDirection = "down" | "up";

export interface GuestKeyEvent {
	direction: GuestKeyDirection;
	key: string;
}

export function parseGuestKeyMessage(message: string): GuestKeyEvent | null {
	if (!message.startsWith(KEY_MSG_PREFIX) || !message.endsWith("__")) return null;
	const body = message.slice(KEY_MSG_PREFIX.length, -"__".length);
	const separator = body.indexOf(":");
	if (separator === -1) return null;
	const direction = body.slice(0, separator);
	const key = body.slice(separator + 1);
	if ((direction !== "down" && direction !== "up") || !key) return null;
	return { direction, key };
}

/** guests can receive garbage (NaN from a bad settings file); the injected
 *  script must always carry a sane literal */
function safeVolume(volume: number): number {
	if (!Number.isFinite(volume)) return 1;
	return Math.min(1, Math.max(0, volume));
}

/**
 * Injected once per guest navigation: mouse back/forward presses reported
 * over the console-message channel (the only guest-to-host channel needing
 * no preload script), keyboard forwarding (while the guest holds focus the
 * host receives no key events, so Escape and the modifier keys are reported
 * over the same channel to keep dismissal and zoom tracking alive), plus a
 * capture-phase play listener that re-applies the volume to media created
 * later (players build their elements lazily).
 */
export function guestBootstrapJs(volume: number): string {
	return (
		`window.addEventListener("mouseup", (e) => {` +
		` if (e.button === 3) console.log("${NAV_BACK_MSG}");` +
		` else if (e.button === 4) console.log("${NAV_FORWARD_MSG}");` +
		` }, true);` +
		` window.addEventListener("mousedown", () => console.log("${GUEST_POINTER_MSG}"), true);` +
		` window.addEventListener("keydown", (e) => {` +
		` if (e.key === "Escape" || e.key === "Control" || e.key === "Meta" || e.key === "Alt" || e.key === "Shift")` +
		` console.log("${KEY_MSG_PREFIX}down:" + e.key + "__");` +
		` }, true);` +
		` window.addEventListener("keyup", (e) => {` +
		` if (e.key === "Control" || e.key === "Meta" || e.key === "Alt" || e.key === "Shift")` +
		` console.log("${KEY_MSG_PREFIX}up:" + e.key + "__");` +
		` }, true);` +
		` if (!window.__hoverlayVolumeHook) {` +
		` window.__hoverlayVolumeHook = true;` +
		` window.addEventListener("play", (e) => {` +
		` const t = e.target;` +
		` if (t && typeof t.volume === "number" && typeof window.__hoverlayVolume === "number")` +
		` { try { t.volume = window.__hoverlayVolume; } catch (err) {} }` +
		` }, true); }` +
		applyVolumeJs(volume)
	);
}

export function applyVolumeJs(volume: number): string {
	const level = safeVolume(volume);
	return (
		` window.__hoverlayVolume = ${level};` +
		` document.querySelectorAll("video, audio").forEach((el) => {` +
		` try { el.volume = ${level}; } catch (err) {} });` +
		` undefined;`
	);
}

export interface ScrollbarColors {
	bg: string;
	thumb: string;
	active: string;
}

/** guest pages keep their own scrollbars; theme them with the vault's
 *  scrollbar colors, resolved by the caller at render time */
export function scrollbarCss(colors: ScrollbarColors): string {
	return `
		::-webkit-scrollbar { width: 12px; height: 12px; background-color: transparent; }
		::-webkit-scrollbar-track { background-color: ${colors.bg}; }
		::-webkit-scrollbar-thumb { background-color: ${colors.thumb}; border-radius: 12px; background-clip: padding-box; border: 3px solid transparent; }
		::-webkit-scrollbar-thumb:hover, ::-webkit-scrollbar-thumb:active { background-color: ${colors.active}; }
		::-webkit-scrollbar-corner { background: transparent; }
	`;
}
