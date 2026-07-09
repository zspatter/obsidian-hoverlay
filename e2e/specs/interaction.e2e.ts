import { before, beforeEach, describe, it } from "mocha";
import { browser, expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	POPOVER,
	dismissPopover,
	hoverAndWaitForPopover,
	parkPointer,
	restoreSettings,
	setSettings,
	snapshotSettings,
} from "../helpers";

const EXAMPLE_LINK = '.markdown-preview-view a[href="https://example.com/"]';
const WEBVIEW = ".hoverlay-webview";
const PIN_BUTTON = '.hoverlay-header [aria-label^="Pin"]';

/** wait for the guest to reach dom-ready: the loading spinner is removed and
 *  the key-forwarding bootstrap has been injected */
async function waitForGuestReady(): Promise<void> {
	await $(".hoverlay-loading").waitForExist({ reverse: true, timeout: 15000 });
}

async function webviewHasHostFocus(): Promise<boolean> {
	return browser.execute(() => {
		const active = document.activeElement;
		return !!active && active.classList.contains("hoverlay-webview");
	});
}

/** run a script inside the guest page of the open preview */
async function runInGuest(code: string): Promise<unknown> {
	return browser.execute((guestCode: string) => {
		const webview = document.querySelector(".hoverlay-webview") as unknown as {
			executeJavaScript(script: string): Promise<unknown>;
		};
		return webview.executeJavaScript(guestCode);
	}, code);
}

describe("guest interaction", function () {
	let defaults: string;

	before(async function () {
		await obsidianPage.openFile("Links.md");
		defaults = await snapshotSettings();
	});

	beforeEach(async function () {
		if (await $(POPOVER).isExisting()) await dismissPopover();
		await restoreSettings(defaults);
	});

	it("webviews use the session-scoped partition by default", async function () {
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		expect(await $(WEBVIEW).getAttribute("partition")).toBe("hoverlay");
	});

	it("remember-preview-logins switches to the persistent partition", async function () {
		await setSettings({ persistLogins: true });
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		expect(await $(WEBVIEW).getAttribute("partition")).toBe("persist:hoverlay");
	});

	it("clicking into the guest hands it the keyboard; typing reaches the page", async function () {
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await waitForGuestReady();
		await $(WEBVIEW).click();
		await browser.waitUntil(webviewHasHostFocus, {
			timeoutMsg: "webview never took host focus after a click",
		});
		// focus an injected input inside the guest and type into it for real
		await runInGuest(
			`const i = document.createElement("input"); i.id = "e2e-input";` +
				` document.body.prepend(i); i.focus(); true;`
		);
		await browser.keys(["h", "i"]);
		expect(
			await runInGuest(`document.getElementById("e2e-input")?.value ?? "(missing)"`)
		).toBe("hi");
		// Escape is forwarded out of the focused guest and still closes
		await dismissPopover();
	});

	it("guest-initiated focus stealing is refused while the pointer is elsewhere", async function () {
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await waitForGuestReady();
		// pin so the popover survives the pointer parking outside it
		await $(PIN_BUTTON).click();
		await parkPointer();
		await runInGuest(
			`const i = document.createElement("input"); document.body.prepend(i); i.focus(); true;`
		);
		// whether Electron transfers host focus or not, the invariant is the
		// same: the webview must not end up holding it without a user click
		await browser.waitUntil(async () => !(await webviewHasHostFocus()), {
			timeoutMsg: "webview kept host focus after an autofocus steal",
		});
		await dismissPopover();
	});

	it("a pinned popover survives clicking elsewhere in the workspace", async function () {
		await hoverAndWaitForPopover(EXAMPLE_LINK);
		await $(PIN_BUTTON).click();
		// the click target must be reliably outside the popover on every OS:
		// the popover overlaps the note title on some window layouts (ubuntu),
		// and WebDriver refuses to click an obscured element
		await $(".nav-file-title-content=Links").click();
		await browser.pause(600); // longer than the hide grace period
		await expect($(POPOVER)).toExist();
		await dismissPopover();
	});
});
