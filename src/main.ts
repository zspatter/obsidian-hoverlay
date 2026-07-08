import { Editor, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, HoverlaySettings, HoverlaySettingTab } from "./settings";
import { getBlockedHosts, parseDomainModes } from "./rules";
import type { DomainModeRule } from "./rules";
import { PopoverManager } from "./popover";

export default class HoverlayPlugin extends Plugin {
	settings: HoverlaySettings = DEFAULT_SETTINGS;
	popovers!: PopoverManager;
	// derived from settings once per change, not re-parsed on every hover
	blockedHosts: string[] = [];
	domainModeRules: DomainModeRule[] = [];

	async onload() {
		await this.loadSettings();

		this.popovers = new PopoverManager(this);
		this.addSettingTab(new HoverlaySettingTab(this.app, this));

		this.addCommand({
			id: "preview-link-under-cursor",
			name: "Preview link under cursor",
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				if (checking) return this.popovers.hasLinkAtEditorCursor(editor);
				return this.popovers.openAtEditorCursor(editor);
			},
		});

		this.registerDomEvent(
			document,
			"mouseover",
			(evt: MouseEvent) => this.popovers.onMouseOver(evt),
			{ capture: true }
		);
		this.registerDomEvent(document, "keydown", (evt: KeyboardEvent) =>
			this.popovers.onKeyDown(evt)
		);
		this.registerDomEvent(document, "keyup", (evt: KeyboardEvent) =>
			this.popovers.onKeyUp(evt)
		);
		this.registerDomEvent(
			document,
			"mousedown",
			(evt: MouseEvent) => this.popovers.onMouseDown(evt),
			{ capture: true }
		);
		this.registerDomEvent(
			document,
			"wheel",
			(evt: WheelEvent) => this.popovers.onWheel(evt),
			{ capture: true, passive: true }
		);
		this.registerDomEvent(window, "blur", () => this.popovers.onWindowBlur());

		// mouse back/forward buttons over the popover drive its history; both
		// pointerup and mouseup are intercepted so Obsidian's own note
		// navigation doesn't also fire (navigation triggers once, on pointerup)
		this.registerDomEvent(
			document,
			"pointerup",
			(evt: PointerEvent) => this.popovers.onAuxPointer(evt, true),
			{ capture: true }
		);
		this.registerDomEvent(
			document,
			"mouseup",
			(evt: MouseEvent) => this.popovers.onAuxPointer(evt, false),
			{ capture: true }
		);
	}

	onunload() {
		this.popovers?.destroy();
	}

	private refreshDerivedSettings() {
		this.blockedHosts = getBlockedHosts(this.settings.domainBlocklist);
		this.domainModeRules = parseDomainModes(this.settings.domainModes);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.refreshDerivedSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshDerivedSettings();
	}
}
