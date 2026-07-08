import { browser, $ } from "@wdio/globals";

export const POPOVER = ".hoverlay-popover";
export const HEADER_URL = ".hoverlay-header-url";

/** park the real pointer on a neutral element: moveTo an element the
 *  pointer already occupies fires no mouseover, so consecutive hover tests
 *  need the pointer to actually leave and re-enter the link */
export async function parkPointer(): Promise<void> {
	await $(".markdown-preview-view h1").moveTo();
}

/** hover an element and wait for the popover (default hover delay is 400ms) */
export async function hoverAndWaitForPopover(selector: string): Promise<void> {
	await parkPointer();
	await $(selector).moveTo();
	await $(POPOVER).waitForExist({ timeout: 8000 });
}

export async function dismissPopover(): Promise<void> {
	await browser.keys(["Escape"]);
	await $(POPOVER).waitForExist({ timeout: 4000, reverse: true });
}

/** place the editor cursor and run the preview-link-under-cursor command */
export async function previewAtCursor(line: number, ch: number): Promise<void> {
	await browser.execute(
		(l: number, c: number) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const view = (window as any).app.workspace.activeLeaf.view;
			view.editor.focus();
			view.editor.setCursor({ line: l, ch: c });
		},
		line,
		ch
	);
	await browser.executeObsidianCommand("hoverlay:preview-link-under-cursor");
	await $(POPOVER).waitForExist({ timeout: 8000 });
}

/** merge values into the live plugin settings (saveSettings refreshes the
 *  derived blocklist/domain-rule caches) */
export async function setSettings(partial: Record<string, unknown>): Promise<void> {
	await browser.execute((p: Record<string, unknown>) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const plugin = (window as any).app.plugins.plugins["hoverlay"];
		Object.assign(plugin.settings, p);
		return plugin.saveSettings();
	}, partial);
}

export async function snapshotSettings(): Promise<string> {
	return browser.execute(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const plugin = (window as any).app.plugins.plugins["hoverlay"];
		return JSON.stringify(plugin.settings);
	});
}

export async function restoreSettings(snapshot: string): Promise<void> {
	await browser.execute((s: string) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const plugin = (window as any).app.plugins.plugins["hoverlay"];
		Object.assign(plugin.settings, JSON.parse(s));
		return plugin.saveSettings();
	}, snapshot);
}
