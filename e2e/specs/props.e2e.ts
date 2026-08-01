import { before, beforeEach, describe, it } from "mocha";
import { browser, expect, $ } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	HEADER_URL,
	POPOVER,
	dismissPopover,
	hoverAndWaitForPopover,
	parkPointer,
	previewAtCursor,
} from "../helpers";

// property links are divs with data-href, never anchors; selectors are
// scoped per surface because the note view and the sidebar can both show
// the same property at once
const READING_SOURCE =
	'.markdown-reading-view .metadata-property[data-property-key="source"] .external-link';
const READING_LIST =
	'.markdown-reading-view .metadata-property[data-property-key="sources"] .external-link';
const READING_WIKILINK =
	'.markdown-reading-view .metadata-property[data-property-key="related"] .internal-link';
const EDITING_SOURCE =
	'.markdown-source-view .metadata-property[data-property-key="source"] .external-link';
const SIDEBAR_SOURCE =
	'.workspace-leaf-content[data-type="file-properties"] .metadata-property[data-property-key="source"] .external-link';

describe("Hoverlay in properties", function () {
	before(async function () {
		await obsidianPage.openFile("Props.md");
	});

	beforeEach(async function () {
		if (await $(POPOVER).isExisting()) await dismissPopover();
		await parkPointer();
	});

	it("previews a URL text property in reading mode", async function () {
		await hoverAndWaitForPopover(READING_SOURCE);
		await expect($(HEADER_URL)).toHaveText("https://example.com/clip");
		await dismissPopover();
	});

	it("previews a URL inside a list property", async function () {
		await hoverAndWaitForPopover(READING_LIST);
		await expect($(HEADER_URL)).toHaveText("https://example.com/list-item");
		await dismissPopover();
	});

	it("previews properties in live preview (pins the properties-before-editor ordering)", async function () {
		// the panel mounts INSIDE .cm-editor in live preview; this asserting
		// a popover proves the properties branch runs before the editor scan
		await browser.executeObsidianCommand("markdown:toggle-preview");
		await hoverAndWaitForPopover(EDITING_SOURCE);
		await expect($(HEADER_URL)).toHaveText("https://example.com/clip");
		await dismissPopover();
		await browser.executeObsidianCommand("markdown:toggle-preview");
	});

	it("previews in the file-properties sidebar", async function () {
		// the Properties view core plugin (owner of properties:open-local) is
		// disabled by default on Obsidian 1.5.3, the CI earliest lane; enable
		// it before invoking the command (no-op where it is already on)
		await browser.execute(() => {
			const { app } = window as unknown as {
				app: {
					internalPlugins: {
						getPluginById(id: string): { enabled: boolean; enable(): Promise<void> } | null;
					};
				};
			};
			const properties = app.internalPlugins.getPluginById("properties");
			if (properties && !properties.enabled) return properties.enable();
		});
		await browser.executeObsidianCommand("properties:open-local");
		await hoverAndWaitForPopover(SIDEBAR_SOURCE);
		await expect($(HEADER_URL)).toHaveText("https://example.com/clip");
		await dismissPopover();
	});

	it("never touches wikilink properties (core Page Preview territory)", async function () {
		await $(READING_WIKILINK).moveTo();
		await browser.pause(1000); // past the hover delay
		expect(await $(POPOVER).isExisting()).toBe(false);
	});

	it("raw source mode still previews frontmatter URLs as plain text (regression pin)", async function () {
		// the sidebar test may have left leaf focus elsewhere; re-focus the note
		await obsidianPage.openFile("Props.md");
		await browser.executeObsidianCommand("markdown:toggle-preview"); // edit mode
		await browser.executeObsidianCommand("editor:toggle-source"); // raw source
		// line 1 is "source: https://example.com/clip"; ch 20 sits inside the
		// URL. Park on the ACTIVE leaf's view header: raw source mode has no
		// inline title, and an unscoped .view-header-title matches a hidden
		// sidebar leaf's header first
		await previewAtCursor(
			1,
			20,
			"https://example.com/clip",
			".workspace-leaf.mod-active .view-header-title"
		);
		await dismissPopover();
		await browser.executeObsidianCommand("editor:toggle-source");
		await browser.executeObsidianCommand("markdown:toggle-preview"); // back to reading
	});
});
