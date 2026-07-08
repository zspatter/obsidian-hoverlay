// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the "obsidian" module id itself is aliased to a stub in vitest.config.ts
vi.mock("@codemirror/view", () => ({
	EditorView: { findFromDOM: () => null },
}));

import "./support/obsidian-dom";
import { PopoverManager } from "../src/popover";
import { getBlockedHosts } from "../src/rules";
import type HoverlayPlugin from "../src/main";
import type { HoverlaySettings } from "../src/settings";

function makePlugin(overrides: Partial<HoverlaySettings> = {}): HoverlayPlugin {
	const settings: HoverlaySettings = {
		renderMode: "card",
		hoverDelay: 400,
		hideDelay: 400,
		stillnessDelay: 0,
		modifiers: [],
		closeOnModifierRelease: false,
		stickyMode: "hover",
		popoverWidth: 480,
		popoverHeight: 340,
		persistResize: true,
		enableEmbeds: true,
		mediaVolume: 1,
		webviewZoom: 0.65,
		zoomModifier: "ctrl",
		domainBlocklist: "",
		domainModes: "",
		...overrides,
	};
	return {
		settings,
		blockedHosts: getBlockedHosts(settings.domainBlocklist),
		domainModeRules: [],
		saveSettings: async () => {},
		app: { metadataCache: { getFirstLinkpathDest: () => null } },
	} as unknown as HoverlayPlugin;
}

let manager: PopoverManager;
let abort: AbortController;

/** wire the manager to the document the way main.ts does */
function wire(plugin: HoverlayPlugin): void {
	manager = new PopoverManager(plugin);
	const signal = abort.signal;
	document.addEventListener("mouseover", (e) => manager.onMouseOver(e), {
		capture: true,
		signal,
	});
	document.addEventListener("keydown", (e) => manager.onKeyDown(e), { signal });
	document.addEventListener("keyup", (e) => manager.onKeyUp(e), { signal });
	document.addEventListener("mousedown", (e) => manager.onMouseDown(e), {
		capture: true,
		signal,
	});
	document.addEventListener("wheel", (e) => manager.onWheel(e), {
		capture: true,
		signal,
	});
}

function addLink(href: string): HTMLAnchorElement {
	const anchor = document.body.createEl("a", { attr: { href } }) as HTMLAnchorElement;
	anchor.textContent = "link";
	return anchor;
}

const hover = (el: Element, init: MouseEventInit = {}) =>
	el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, ...init }));
const leave = (el: Element) => el.dispatchEvent(new MouseEvent("mouseleave"));
const mousedownOn = (el: Element, init: MouseEventInit = {}) =>
	el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, ...init }));
const pressKey = (type: "keydown" | "keyup", init: KeyboardEventInit) =>
	document.dispatchEvent(new KeyboardEvent(type, init));
const popover = () => document.querySelector<HTMLElement>(".hoverlay-popover");
const headerUrl = () => popover()?.querySelector(".hoverlay-header-url")?.textContent;
const headerButton = (labelPrefix: string) =>
	popover()?.querySelector<HTMLElement>(`[aria-label^="${labelPrefix}"]`);

beforeEach(() => {
	abort = new AbortController();
	vi.useFakeTimers();
});

afterEach(() => {
	manager?.destroy();
	abort.abort();
	document.body.innerHTML = "";
	vi.useRealTimers();
});

describe("hover trigger", () => {
	it("opens after the hover delay, not before", () => {
		wire(makePlugin());
		hover(addLink("https://example.com/"));
		vi.advanceTimersByTime(399);
		expect(popover()).toBeNull();
		vi.advanceTimersByTime(1);
		expect(popover()).not.toBeNull();
		expect(headerUrl()).toBe("https://example.com/");
	});

	it("cancels when the pointer leaves the link before the delay", () => {
		wire(makePlugin());
		const link = addLink("https://example.com/");
		hover(link);
		vi.advanceTimersByTime(200);
		leave(link);
		vi.advanceTimersByTime(2000);
		expect(popover()).toBeNull();
	});

	it("normalizes scheme-less hrefs", () => {
		wire(makePlugin());
		hover(addLink("www.example.com"));
		vi.advanceTimersByTime(400);
		expect(headerUrl()).toBe("https://www.example.com");
	});

	it("never touches internal links", () => {
		wire(makePlugin());
		const link = addLink("Some Note");
		link.classList.add("internal-link");
		hover(link);
		vi.advanceTimersByTime(1000);
		expect(popover()).toBeNull();
	});

	it("respects the domain blocklist", () => {
		wire(makePlugin({ domainBlocklist: "example.com" }));
		hover(addLink("https://sub.example.com/page"));
		vi.advanceTimersByTime(1000);
		expect(popover()).toBeNull();
	});

	it("stillness delay restarts the countdown on pointer movement", () => {
		wire(makePlugin({ stillnessDelay: 300 }));
		const link = addLink("https://example.com/");
		hover(link);
		vi.advanceTimersByTime(399);
		link.dispatchEvent(new MouseEvent("mousemove"));
		vi.advanceTimersByTime(299);
		expect(popover()).toBeNull();
		vi.advanceTimersByTime(1);
		expect(popover()).not.toBeNull();
	});
});

describe("trigger modifiers", () => {
	it("requires the configured modifier combination", () => {
		wire(makePlugin({ modifiers: ["ctrl"] }));
		const link = addLink("https://example.com/");
		hover(link);
		vi.advanceTimersByTime(1000);
		expect(popover()).toBeNull();
		hover(link, { ctrlKey: true });
		vi.advanceTimersByTime(400);
		expect(popover()).not.toBeNull();
	});

	it("closes on modifier release when configured", () => {
		wire(makePlugin({ modifiers: ["ctrl"], closeOnModifierRelease: true }));
		hover(addLink("https://example.com/"), { ctrlKey: true });
		vi.advanceTimersByTime(400);
		expect(popover()).not.toBeNull();
		pressKey("keyup", { key: "Control", ctrlKey: false });
		expect(popover()).toBeNull();
	});
});

describe("dismissal", () => {
	it("hover mode: grace period after leaving, re-entry cancels", () => {
		wire(makePlugin());
		const link = addLink("https://example.com/");
		hover(link);
		vi.advanceTimersByTime(400);
		leave(link);
		vi.advanceTimersByTime(399);
		expect(popover()).not.toBeNull();
		hover(popover()!); // pointer reaches the popover: keep alive
		vi.advanceTimersByTime(2000);
		expect(popover()).not.toBeNull();
		leave(popover()!);
		vi.advanceTimersByTime(400);
		expect(popover()).toBeNull();
	});

	it("sticky mode: survives pointer leaving, closes on Escape", () => {
		wire(makePlugin({ stickyMode: "sticky" }));
		const link = addLink("https://example.com/");
		hover(link);
		vi.advanceTimersByTime(400);
		leave(link);
		hover(document.body);
		vi.advanceTimersByTime(5000);
		expect(popover()).not.toBeNull();
		pressKey("keydown", { key: "Escape" });
		expect(popover()).toBeNull();
	});

	it("click outside closes; mouse back/forward buttons do not", () => {
		wire(makePlugin({ stickyMode: "sticky" }));
		hover(addLink("https://example.com/"));
		vi.advanceTimersByTime(400);
		mousedownOn(document.body, { button: 3 });
		expect(popover()).not.toBeNull();
		mousedownOn(document.body, { button: 0 });
		expect(popover()).toBeNull();
	});

	it("pin suspends hover dismissal until Escape", () => {
		wire(makePlugin());
		const link = addLink("https://example.com/");
		hover(link);
		vi.advanceTimersByTime(400);
		headerButton("Pin")!.dispatchEvent(new MouseEvent("click"));
		leave(popover()!);
		hover(document.body);
		vi.advanceTimersByTime(5000);
		expect(popover()).not.toBeNull();
		pressKey("keydown", { key: "Escape" });
		expect(popover()).toBeNull();
	});

	it("wheel outside closes; wheel inside the popover does not", () => {
		wire(makePlugin());
		hover(addLink("https://example.com/"));
		vi.advanceTimersByTime(400);
		popover()!.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
		expect(popover()).not.toBeNull();
		document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
		expect(popover()).toBeNull();
	});

	it("modifier release closes even a pinned popover (documented behavior)", () => {
		wire(makePlugin({ modifiers: ["ctrl"], closeOnModifierRelease: true }));
		hover(addLink("https://example.com/"), { ctrlKey: true });
		vi.advanceTimersByTime(400);
		headerButton("Pin")!.dispatchEvent(new MouseEvent("click"));
		pressKey("keyup", { key: "Control", ctrlKey: false });
		expect(popover()).toBeNull();
	});

	it("maximize suspends dismissal; restore defers it by a grace period", () => {
		wire(makePlugin());
		hover(addLink("https://example.com/"));
		vi.advanceTimersByTime(400);
		const maximize = headerButton("Maximize")!;
		maximize.dispatchEvent(new MouseEvent("click"));
		leave(popover()!);
		hover(document.body);
		vi.advanceTimersByTime(5000);
		expect(popover()).not.toBeNull(); // maximized: no hover dismissal

		maximize.dispatchEvent(new MouseEvent("click")); // restore
		hover(document.body);
		// hide delay (400) is deferred by the 1500ms post-restore grace
		vi.advanceTimersByTime(1899);
		expect(popover()).not.toBeNull();
		vi.advanceTimersByTime(1);
		expect(popover()).toBeNull();
	});
});

describe("dismissal permutation matrix", () => {
	interface Scenario {
		name: string;
		sticky: boolean;
		suspend: "none" | "pin" | "maximize";
	}
	// pin only exists in hover mode, so sticky/pinned is not a real cell
	const scenarios: Scenario[] = [
		{ name: "hover, plain", sticky: false, suspend: "none" },
		{ name: "hover, pinned", sticky: false, suspend: "pin" },
		{ name: "hover, maximized", sticky: false, suspend: "maximize" },
		{ name: "sticky, plain", sticky: true, suspend: "none" },
		{ name: "sticky, maximized", sticky: true, suspend: "maximize" },
	];

	for (const scenario of scenarios) {
		const closesOnLeave = !scenario.sticky && scenario.suspend === "none";

		it(`${scenario.name}: leave ${closesOnLeave ? "closes" : "keeps open"}; Escape and click outside always close`, () => {
			wire(makePlugin({ stickyMode: scenario.sticky ? "sticky" : "hover" }));

			const openPopover = () => {
				const link = addLink("https://example.com/");
				hover(link);
				vi.advanceTimersByTime(400);
				expect(popover()).not.toBeNull();
				if (scenario.suspend === "pin") {
					headerButton("Pin")!.dispatchEvent(new MouseEvent("click"));
				}
				if (scenario.suspend === "maximize") {
					headerButton("Maximize")!.dispatchEvent(new MouseEvent("click"));
				}
				return link;
			};

			// pointer leaves the popover and wanders the document
			const link = openPopover();
			leave(popover()!);
			leave(link);
			hover(document.body);
			vi.advanceTimersByTime(5000);
			if (closesOnLeave) {
				expect(popover()).toBeNull();
			} else {
				expect(popover()).not.toBeNull();
			}

			// Escape always closes
			if (!popover()) openPopover();
			pressKey("keydown", { key: "Escape" });
			expect(popover()).toBeNull();

			// click outside always closes
			openPopover();
			mousedownOn(document.body);
			expect(popover()).toBeNull();
		});
	}
});
