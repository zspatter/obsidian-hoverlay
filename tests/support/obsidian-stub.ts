/**
 * Runtime stand-in for the "obsidian" package in tests. The real package is
 * types-only (no runtime entry), so Vitest aliases the module id here (see
 * vitest.config.ts). Only what the code under test touches at runtime.
 *
 * This folder holds test infrastructure, not tests: suites live in
 * *.test.ts files next to the modules they cover.
 */

// false forces the card renderer, the jsdom default; the guest-interaction
// suite in popover.test.ts flips this to reach the webview renderer
export const Platform = { isDesktopApp: false };

export function setIcon(): void {}

export async function requestUrl(): Promise<{ status: number; text: string }> {
	return {
		status: 200,
		text: "<html><head><title>Stub</title></head><body></body></html>",
	};
}
