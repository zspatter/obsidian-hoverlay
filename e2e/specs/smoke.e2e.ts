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
