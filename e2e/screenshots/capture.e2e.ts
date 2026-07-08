import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { after, before, describe, it } from "mocha";
import { browser, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	dismissPopover,
	hoverAndWaitForPopover,
	parkPointer,
	restoreSettings,
	setSettings,
	snapshotSettings,
} from "../helpers";

const OUT = "docs/screenshots";
const FRAMES = "e2e/screenshots/frames";
const ARTICLE_LINK = '.markdown-preview-view a[href^="https://en.wikipedia.org"]';
const VIDEO_LINK = '.markdown-preview-view a[href^="https://www.youtube.com"]';
const SONG_LINK = '.markdown-preview-view a[href^="https://open.spotify.com"]';
const HOMEPAGE_LINK = '.markdown-preview-view a[href="https://obsidian.md/"]';

describe("capture screenshots", function () {
	let defaults: string;
	let frame = 0;

	const snapFrame = async () => {
		await browser.saveScreenshot(
			path.join(FRAMES, `frame-${String(frame++).padStart(2, "0")}.png`)
		);
	};

	before(async function () {
		mkdirSync(OUT, { recursive: true });
		mkdirSync(FRAMES, { recursive: true });
		// note: setWindowSize is unsupported on Electron sessions (no
		// window/rect endpoint); the launcher's default window size stands
		await obsidianPage.openFile("Links.md");
		defaults = await snapshotSettings();
	});

	after(async function () {
		await restoreSettings(defaults);
	});

	it("hover action frames for the gif", async function () {
		// act 1: park, approach, dwell, popover, page paint
		await parkPointer();
		await snapFrame();
		await $(ARTICLE_LINK).moveTo();
		for (let i = 0; i < 9; i++) {
			await snapFrame();
			await browser.pause(280);
		}

		const webview = await $(".hoverlay-webview");

		// act 2: scroll the article inside the guest
		for (let i = 0; i < 3; i++) {
			await browser.action("wheel").scroll({ origin: webview, deltaY: 420 }).perform();
			await browser.pause(250);
			await snapFrame();
		}

		// act 3: drag a corner to grow the popover. The southwest corner grows
		// leftward into open note space; the southeast one would walk the
		// pointer out of the window (move target out of bounds)
		const corner = await $(".hoverlay-resize-sw");
		await browser
			.action("pointer")
			.move({ origin: corner })
			.down()
			.move({ origin: "pointer", x: -50, y: 20 })
			.move({ origin: "pointer", x: -50, y: 20 })
			.up()
			.perform();
		await browser.pause(250);
		await snapFrame();

		// act 4: drag the header to reposition (grab left of the buttons)
		const header = await $(".hoverlay-header");
		await browser
			.action("pointer")
			.move({ origin: header, x: -120, y: 0 })
			.down()
			.move({ origin: "pointer", x: -70, y: -45 })
			.move({ origin: "pointer", x: -70, y: -45 })
			.up()
			.perform();
		await browser.pause(250);
		await snapFrame();
		await snapFrame(); // hold the final state a beat before the loop restarts

		await dismissPopover();
	});

	it("hero shot", async function () {
		await hoverAndWaitForPopover(HOMEPAGE_LINK);
		await browser.pause(3500); // let the page paint
		await browser.saveScreenshot(`${OUT}/hover-preview.png`);
		await dismissPopover();
	});

	it("embedded video playing with the volume flyout", async function () {
		await hoverAndWaitForPopover(VIDEO_LINK);
		await browser.pause(3000); // player chrome
		await $(".hoverlay-webview").click(); // play
		await browser.pause(2500);
		// embeds start audible, so the speaker offers Mute from the start
		const speaker = $('.hoverlay-header [aria-label="Mute"]');
		await speaker.waitForExist({ timeout: 8000 });
		await speaker.moveTo(); // reveals the volume flyout
		await browser.pause(400);
		await browser.saveScreenshot(`${OUT}/media-browser.png`);
		await dismissPopover();
	});

	it("spotify embed", async function () {
		// a popover taller than Spotify's 352px card, so the shot shows the
		// fit-to-content trim hugging the card instead of clipping it
		await setSettings({ popoverHeight: 520 });
		await hoverAndWaitForPopover(SONG_LINK);
		await browser.pause(3500); // embed card + artwork
		await $(".hoverlay-webview").click(); // start the preview
		await browser.pause(2000);
		await browser.saveScreenshot(`${OUT}/spotify-embed.png`);
		await dismissPopover();
		await restoreSettings(defaults);
	});

	it("settings tab", async function () {
		await browser.executeObsidianCommand("app:open-settings");
		await $(".vertical-tab-nav-item=Hoverlay").click();
		await browser.pause(500);
		await browser.saveScreenshot(`${OUT}/settings.png`);
		await browser.keys(["Escape"]);
	});
});
