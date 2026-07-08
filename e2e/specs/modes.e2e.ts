import { before, beforeEach, describe, it } from "mocha";
import { expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	HEADER_URL,
	POPOVER,
	dismissPopover,
	hoverAndWaitForPopover,
	restoreSettings,
	setSettings,
	snapshotSettings,
} from "../helpers";

const EXAMPLE_LINK = '.markdown-preview-view a[href="https://example.com/"]';
const VIDEO_LINK = '.markdown-preview-view a[href^="https://www.youtube.com"]';
const ARTICLE_LINK = '.markdown-preview-view a[href^="https://en.wikipedia.org"]';

describe("preview modes", function () {
	let defaults: string;

	before(async function () {
		await obsidianPage.openFile("Links.md");
		defaults = await snapshotSettings();
	});

	beforeEach(async function () {
		if (await $(POPOVER).isExisting()) await dismissPopover();
		await restoreSettings(defaults);
	});

	it("auto mode uses the live webview", async function () {
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-webview")).toExist();
	});

	it("webview mode shows the history controls", async function () {
		await setSettings({ renderMode: "webview" });
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-webview")).toExist();
		const nav = $(".hoverlay-header-nav");
		await expect(nav).toExist();
		expect(await nav.getAttribute("class")).not.toContain("is-hidden");
	});

	it("card mode renders metadata without loading the page", async function () {
		await setSettings({ renderMode: "card" });
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-card")).toExist();
		await expect($(".hoverlay-webview")).not.toExist();
		await expect($(".hoverlay-card-title")).toHaveText("Example Domain");
		// cards have no history or audio: the nav cluster stays hidden
		expect(await $(".hoverlay-header-nav").getAttribute("class")).toContain("is-hidden");
	});

	it("reader mode extracts the article text", async function () {
		await setSettings({ renderMode: "reader" });
		await hoverAndWaitForPopover(ARTICLE_LINK);
		await expect($(".hoverlay-reader")).toExist();
		await $(".hoverlay-reader-body").waitForExist({ timeout: 15000 });
		await expect($(".hoverlay-webview")).not.toExist();
	});

	it("embeds media links as the provider player, keeping the link URL", async function () {
		await hoverAndWaitForPopover(VIDEO_LINK);
		const webview = $(".hoverlay-webview");
		await expect(webview).toExist();
		expect(await webview.getAttribute("src")).toContain("youtube.com/embed/jNQXAC9IVRw");
		await expect($(HEADER_URL)).toHaveText("https://www.youtube.com/watch?v=jNQXAC9IVRw");
		// deliberate media starts audible, so the speaker offers Mute
		await expect($('.hoverlay-header [aria-label="Mute"]')).toExist();
	});

	it("embeds toggle off loads the raw media page", async function () {
		await setSettings({ enableEmbeds: false });
		await hoverAndWaitForPopover(VIDEO_LINK);
		const src = await $(".hoverlay-webview").getAttribute("src");
		expect(src).toContain("youtube.com/watch");
		expect(src).not.toContain("/embed/");
	});

	it("per-domain overrides beat the global mode", async function () {
		await setSettings({ renderMode: "auto", domainModes: "example.com: card" });
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await expect($(".hoverlay-card")).toExist();
		await expect($(".hoverlay-webview")).not.toExist();
	});
});
