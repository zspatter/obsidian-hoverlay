import { before, beforeEach, describe, it } from "mocha";
import { browser, expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

const POPOVER = ".hoverlay-popover";
const HEADER_URL = ".hoverlay-header-url";

/** park the real pointer on a neutral element: moveTo an element the
 *  pointer already occupies fires no mouseover, so consecutive hover tests
 *  need the pointer to actually leave and re-enter the link */
async function parkPointer(): Promise<void> {
	await $(".markdown-preview-view h1").moveTo();
}

/** hover an element and wait for the popover (default hover delay is 400ms) */
async function hoverAndWaitForPopover(selector: string): Promise<void> {
	await parkPointer();
	await $(selector).moveTo();
	await $(POPOVER).waitForExist({ timeout: 8000 });
}

/** place the editor cursor and run the preview-link-under-cursor command */
async function previewAtCursor(line: number, ch: number): Promise<void> {
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

async function dismissPopover(): Promise<void> {
	await browser.keys(["Escape"]);
	await $(POPOVER).waitForExist({ timeout: 4000, reverse: true });
}

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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const app = (window as any).app;
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
		await previewAtCursor(2, 12); // inside [Example](https://example.com/)
		await expect($(HEADER_URL)).toHaveText("https://example.com/");
		await dismissPopover();
		await browser.executeObsidianCommand("markdown:toggle-preview"); // back to reading
	});

	it("normalizes scheme-less link targets in the editor", async function () {
		// reading mode renders scheme-less markdown links as internal links,
		// which Hoverlay deliberately leaves to core Page Preview; the
		// normalization lives in the editor path, so test it there
		await browser.executeObsidianCommand("markdown:toggle-preview"); // edit mode
		await previewAtCursor(4, 14); // inside [Site](www.example.com)
		await expect($(HEADER_URL)).toHaveText("https://www.example.com");
		await dismissPopover();
		await browser.executeObsidianCommand("markdown:toggle-preview"); // back to reading
	});
});
