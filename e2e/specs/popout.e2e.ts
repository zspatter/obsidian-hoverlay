import { after, before, describe, it } from "mocha";
import { browser, expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { HEADER_URL, dismissPopover, hoverAndWaitForPopover } from "../helpers";

/** pop-out windows have their own document; hovers there must behave
 *  exactly like the main window, with the popover mounted in the pop-out */
describe("Hoverlay in pop-out windows", function () {
	let mainHandle: string;

	before(async function () {
		mainHandle = await browser.getWindowHandle();
		await obsidianPage.openFile("Links.md");
		await browser.executeObsidianCommand("workspace:move-to-new-window");
		await browser.waitUntil(
			async () => (await browser.getWindowHandles()).length > 1,
			{ timeout: 8000, timeoutMsg: "pop-out window never appeared" }
		);
		const handles = await browser.getWindowHandles();
		const popout = handles.find((handle) => handle !== mainHandle);
		if (!popout) throw new Error("no pop-out window handle");
		await browser.switchToWindow(popout);
		await $(".markdown-preview-view a.external-link").waitForExist({ timeout: 8000 });
	});

	after(async function () {
		// only close a pop-out; if setup failed there is just the main window
		const handles = await browser.getWindowHandles();
		if (handles.length > 1 && (await browser.getWindowHandle()) !== mainHandle) {
			await browser.closeWindow();
		}
		await browser.switchToWindow(mainHandle);
	});

	it("previews a hovered link, mounted in the pop-out's own document", async function () {
		await hoverAndWaitForPopover(".markdown-preview-view a.external-link");
		await expect($(HEADER_URL)).toHaveText("https://example.com/");
		// this execute runs in the pop-out window: the popover must be here
		const inPopout = await browser.execute(
			() => document.querySelector(".hoverlay-popover") !== null
		);
		expect(inPopout).toBe(true);
		await dismissPopover();
	});
});
