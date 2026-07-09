import { browser, $ } from "@wdio/globals";

export const POPOVER = ".hoverlay-popover";
export const HEADER_URL = ".hoverlay-header-url";

/** the slice of Obsidian's in-page surface the execute() callbacks touch,
 *  typed structurally: types erase before the callback is serialized into
 *  the browser, and no `any` casts (or lint waivers) are needed */
type PluginHandle = {
	settings: Record<string, unknown>;
	saveSettings(): Promise<void>;
};
export type ObsidianWindow = {
	app: {
		plugins: { plugins: Record<string, PluginHandle | undefined> };
		workspace: {
			activeLeaf: {
				view: {
					editor: {
						focus(): void;
						setCursor(pos: { line: number; ch: number }): void;
					};
				};
			};
		};
	};
};

/** park the real pointer on a neutral element: moveTo an element the
 *  pointer already occupies fires no mouseover, so consecutive hover tests
 *  need the pointer to actually leave and re-enter the link. The default
 *  target exists in markdown views; other view types pass their own. */
export async function parkPointer(selector = ".inline-title"): Promise<void> {
	await $(selector).moveTo();
}

/** hover an element and wait for the popover (default hover delay is 400ms).
 *  A cold session can shift layout between computing the pointer target and
 *  the mouseover landing, so one missed hover must not fail the spec:
 *  re-park and re-hover, like a person jiggling the mouse. */
export async function hoverAndWaitForPopover(
	selector: string,
	park = ".inline-title"
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		await parkPointer(park);
		await $(selector).moveTo();
		try {
			await $(POPOVER).waitForExist({ timeout: 4000 });
			return;
		} catch (err) {
			if (attempt >= 2) throw err;
		}
	}
}

export async function dismissPopover(): Promise<void> {
	// a just-loaded guest page can steal keyboard focus for an instant before
	// the plugin refuses it (and before the bootstrap that forwards Escape is
	// injected at dom-ready); an Escape landing in that gap is swallowed, so
	// keep pressing until the popover actually closes
	await browser.waitUntil(
		async () => {
			await browser.keys(["Escape"]);
			return !(await $(POPOVER).isExisting());
		},
		{
			timeout: 8000,
			interval: 500,
			timeoutMsg: "popover still existing after repeated Escapes",
		}
	);
}

/** place the editor cursor and run the preview-link-under-cursor command */
export async function previewAtCursor(line: number, ch: number): Promise<void> {
	await browser.execute(
		(l: number, c: number) => {
			const { app } = window as unknown as ObsidianWindow;
			const view = app.workspace.activeLeaf.view;
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
		const { app } = window as unknown as ObsidianWindow;
		const plugin = app.plugins.plugins["hoverlay"];
		if (!plugin) throw new Error("hoverlay plugin not loaded");
		Object.assign(plugin.settings, p);
		return plugin.saveSettings();
	}, partial);
}

export async function snapshotSettings(): Promise<string> {
	return browser.execute(() => {
		const { app } = window as unknown as ObsidianWindow;
		const plugin = app.plugins.plugins["hoverlay"];
		if (!plugin) throw new Error("hoverlay plugin not loaded");
		return JSON.stringify(plugin.settings);
	});
}

export async function restoreSettings(snapshot: string): Promise<void> {
	await browser.execute((s: string) => {
		const { app } = window as unknown as ObsidianWindow;
		const plugin = app.plugins.plugins["hoverlay"];
		if (!plugin) throw new Error("hoverlay plugin not loaded");
		Object.assign(plugin.settings, JSON.parse(s) as Record<string, unknown>);
		return plugin.saveSettings();
	}, snapshot);
}
