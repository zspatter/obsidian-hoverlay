import { mkdirSync } from "node:fs";
import { before, describe, it } from "mocha";
import { browser, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { dismissPopover, hoverAndWaitForPopover } from "../helpers";

const OUT = "docs/screenshots";

describe("capture screenshots", function () {
	before(async function () {
		mkdirSync(OUT, { recursive: true });
		// note: setWindowSize is unsupported on Electron sessions (no
		// window/rect endpoint); the launcher's default window size stands
		await obsidianPage.openFile("Links.md");
	});

	it("hover preview (webview)", async function () {
		await hoverAndWaitForPopover('.markdown-preview-view a[href="https://example.com/"]');
		await browser.pause(2500); // let the guest page paint
		await browser.saveScreenshot(`${OUT}/hover-preview.png`);
		await dismissPopover();
	});

	it("embedded player", async function () {
		await hoverAndWaitForPopover('.markdown-preview-view a[href^="https://www.youtube.com"]');
		await browser.pause(3500); // player chrome takes a moment
		await browser.saveScreenshot(`${OUT}/embed-player.png`);
		await dismissPopover();
	});

	it("settings tab", async function () {
		await browser.executeObsidianCommand("app:open-settings");
		await $(".vertical-tab-nav-item=Hoverlay").click();
		await browser.pause(500);
		await browser.saveScreenshot(`${OUT}/settings.png`);
		await browser.keys(["Escape"]);
	});
});
