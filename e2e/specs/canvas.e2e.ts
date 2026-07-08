import { before, beforeEach, describe, it } from "mocha";
import { expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { HEADER_URL, POPOVER, dismissPopover, hoverAndWaitForPopover } from "../helpers";

/** canvas text cards render markdown outside any markdown leaf; hovers
 *  there must resolve the same way they do in notes */
describe("Hoverlay in Canvas", function () {
	before(async function () {
		await obsidianPage.openFile("Board.canvas");
	});

	beforeEach(async function () {
		if (await $(POPOVER).isExisting()) await dismissPopover();
	});

	it("previews an external link inside a canvas text card", async function () {
		// park on the status bar: canvas views have no inline title
		await hoverAndWaitForPopover(".canvas-node a.external-link", ".status-bar");
		await expect($(HEADER_URL)).toHaveText("https://example.com/");
		await dismissPopover();
	});
});
