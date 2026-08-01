import { before, beforeEach, describe, it } from "mocha";
import { browser, expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	HEADER_URL,
	POPOVER,
	dismissPopover,
	hoverAndWaitForPopover,
	previewAtCursor,
} from "../helpers";
import type { ObsidianWindow } from "../helpers";

describe("Hoverlay smoke", function () {
	before(async function () {
		await obsidianPage.openFile("Links.md");
	});

	beforeEach(async function () {
		// stray popovers from a previous test must never leak into the next
		if (await $(POPOVER).isExisting()) await dismissPopover();
	});

	it("loads the plugin", async function () {
		const loaded = await browser.execute(() => {
			const { app } = window as unknown as ObsidianWindow;
			return !!app.plugins.plugins["hoverlay"];
		});
		expect(loaded).toBe(true);
	});

	it("previews an external link on hover in reading mode", async function () {
		await hoverAndWaitForPopover(".markdown-preview-view a.external-link");
		await expect($(HEADER_URL)).toHaveText("https://example.com/");
	});

	it("closes on Escape", async function () {
		await hoverAndWaitForPopover(".markdown-preview-view a.external-link");
		await dismissPopover();
	});

	it("opens a preview for the link under the editor cursor via the command", async function () {
		await browser.executeObsidianCommand("markdown:toggle-preview"); // edit mode
		await previewAtCursor(0, 12, "https://example.com/"); // inside [Example](https://example.com/)
		await expect($(HEADER_URL)).toHaveText("https://example.com/");
		await dismissPopover();
		await browser.executeObsidianCommand("markdown:toggle-preview"); // back to reading
	});

	it("declarative setting definitions reach Obsidian's settings registry", async function () {
		const controlKeys = await browser.execute(() => {
			const { app } = window as unknown as {
				app: {
					setting: {
						pluginTabs: Array<{ id: string; getSettingDefinitions?: () => unknown }>;
					};
				};
			};
			const tab = app.setting.pluginTabs.find((t) => t.id === "hoverlay");
			// the method is Hoverlay's own override, so it exists on every
			// Obsidian version (pre-1.13 simply never calls it); the null
			// guard only covers app.setting shape drift
			if (!tab || typeof tab.getSettingDefinitions !== "function") return null;
			const collect = (items: unknown[]): string[] =>
				items.flatMap((item) => {
					const node = item as {
						control?: { key?: string };
						items?: unknown[];
					};
					return [
						...(node.control?.key ? [node.control.key] : []),
						...(node.items ? collect(node.items) : []),
					];
				});
			return collect(tab.getSettingDefinitions() as unknown[]);
		});
		if (controlKeys === null) return this.skip(); // earliest lane
		expect(controlKeys).toContain("renderMode");
		expect(controlKeys).toContain("domainBlocklist");
		expect(controlKeys.length).toBeGreaterThanOrEqual(16);
	});

	it("the rendered settings tab shows the custom modifier and zoom controls", async function () {
		// 1.13+ renders declaratively (render callbacks), 1.5.3 via the
		// display() interpreter; both must produce the same custom rows,
		// which the registry test above cannot see
		const probe = await browser.execute(() => {
			const { app } = window as unknown as {
				app: {
					setting: {
						open(): void;
						openTabById(id: string): void;
						close(): void;
						activeTab: { containerEl: HTMLElement } | null;
					};
				};
			};
			app.setting.open();
			app.setting.openTabById("hoverlay");
			const container = app.setting.activeTab?.containerEl;
			const buttons = container
				? Array.from(container.querySelectorAll("button")).map((b) => b.textContent ?? "")
				: [];
			const hasZoomSelect = !!container?.querySelector("select.hoverlay-zoom-select");
			const settingCount = container?.querySelectorAll(".setting-item").length ?? 0;
			app.setting.close();
			return { buttons: buttons.join("|"), hasZoomSelect, settingCount };
		});
		expect(probe.buttons).toContain("Ctrl");
		expect(probe.buttons).toContain("Alt");
		expect(probe.hasZoomSelect).toBe(true);
		expect(probe.settingCount).toBeGreaterThanOrEqual(16);
		// on 1.13+ settings opens in its OWN WINDOW; closing it can leave
		// Obsidian's activeWindow/activeDocument pointing at the dead window
		// indefinitely (the plugin's show() falls back to the main document
		// for exactly this case). Re-focus the EXISTING note leaf; openFile
		// here would open a second Links.md tab and hide the first leaf's
		// elements from unscoped selectors like parkPointer's .inline-title
		await browser.execute(() => {
			const { app } = window as unknown as {
				app: {
					workspace: {
						getLeavesOfType(type: string): unknown[];
						setActiveLeaf(leaf: unknown): void;
					};
				};
			};
			const leaf = app.workspace.getLeavesOfType("markdown")[0];
			if (leaf) app.workspace.setActiveLeaf(leaf);
		});
	});

	it("normalizes scheme-less link targets in the editor", async function () {
		// reading mode renders scheme-less markdown links as internal links,
		// which Hoverlay deliberately leaves to core Page Preview; the
		// normalization lives in the editor path, so test it there
		await browser.executeObsidianCommand("markdown:toggle-preview"); // edit mode
		await previewAtCursor(2, 14, "https://www.example.com"); // inside [Site](www.example.com)
		await expect($(HEADER_URL)).toHaveText("https://www.example.com");
		await dismissPopover();
		await browser.executeObsidianCommand("markdown:toggle-preview"); // back to reading
	});
});
