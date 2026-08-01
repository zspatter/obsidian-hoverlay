import { App, PluginSettingTab, Setting, requireApiVersion } from "obsidian";
import type { SettingControl, SettingDefinitionItem } from "obsidian";
import type HoverlayPlugin from "./main";
import { resolveZoomModifier, zoomConflictsWithTriggers } from "./rules";
import type { ModifierKey, RenderMode, ZoomModifier } from "./rules";
import type { StickyMode } from "./dismissal";

export type { StickyMode };

export const MODIFIER_LABELS: Record<ModifierKey, string> = {
	ctrl: "Ctrl",
	alt: "Alt",
	shift: "Shift",
	meta: "Cmd/Win",
};

export interface HoverlaySettings {
	/** auto = webview on desktop, card on mobile; card = metadata card everywhere */
	renderMode: RenderMode;
	/** ms the pointer must rest on a link before the popover appears */
	hoverDelay: number;
	/** ms grace period before the popover closes after the pointer leaves */
	hideDelay: number;
	/** additional ms of pointer stillness required; any movement restarts this countdown (0 = off) */
	stillnessDelay: number;
	/** modifiers that must all be held for the popover to trigger ([] = none) */
	modifiers: ModifierKey[];
	/** close the popover as soon as a required modifier is released */
	closeOnModifierRelease: boolean;
	/** hover = closes when the pointer leaves; sticky = stays until a click elsewhere */
	stickyMode: StickyMode;
	/** Escape closes the preview; off for Vim users, where Escape is part of typing */
	closeOnEscape: boolean;
	popoverWidth: number;
	popoverHeight: number;
	/** remember the size after dragging the popover edges */
	persistResize: boolean;
	/** in auto mode, load supported media links as the provider's embedded player */
	enableEmbeds: boolean;
	/** playback volume for media inside previews, 0..1 (global, not per-site) */
	mediaVolume: number;
	/** zoom factor applied to the webview so pages read like a thumbnail */
	webviewZoom: number;
	/** keep preview logins (cookies) on disk across Obsidian restarts */
	persistLogins: boolean;
	/** key held (with scroll) to zoom an open preview */
	zoomModifier: ZoomModifier;
	/** one hostname per line; subdomains match their parent entries */
	domainBlocklist: string;
	/** "host: mode" per line; overrides the preview mode for matching hosts */
	domainModes: string;
}

export const DEFAULT_SETTINGS: HoverlaySettings = {
	renderMode: "auto",
	hoverDelay: 400,
	hideDelay: 400,
	stillnessDelay: 0,
	modifiers: [],
	closeOnModifierRelease: false,
	stickyMode: "hover",
	closeOnEscape: true,
	popoverWidth: 480,
	popoverHeight: 340,
	persistResize: true,
	enableEmbeds: true,
	mediaVolume: 1,
	webviewZoom: 0.65,
	persistLogins: false,
	zoomModifier: "ctrl",
	domainBlocklist: "",
	domainModes: "",
};

export interface NumberFieldSpec {
	/** min/max/step are in display units (after displayScale is applied) */
	min: number;
	max: number;
	step: number;
	/** display multiplier, e.g. 100 to show a 0..1 factor as percent */
	displayScale?: number;
}

export type NumberFieldKey =
	| "hoverDelay"
	| "stillnessDelay"
	| "hideDelay"
	| "mediaVolume"
	| "popoverWidth"
	| "popoverHeight"
	| "webviewZoom";

/** the single source of truth for numeric bounds: both the imperative
 *  display() fields and the declarative setting definitions read this, so
 *  the two representations cannot drift */
export const NUMBER_FIELDS: Record<NumberFieldKey, NumberFieldSpec> = {
	hoverDelay: { min: 0, max: 3000, step: 50 },
	stillnessDelay: { min: 0, max: 3000, step: 50 },
	hideDelay: { min: 100, max: 3000, step: 50 },
	mediaVolume: { min: 0, max: 100, step: 5, displayScale: 100 },
	popoverWidth: { min: 260, max: 2000, step: 20 },
	popoverHeight: { min: 180, max: 1500, step: 20 },
	webviewZoom: { min: 25, max: 150, step: 5, displayScale: 100 },
};

/** display units -> stored value: clamp to the spec's bounds, then undo the
 *  display scaling without leaving float dust (65% -> exactly 0.65) */
export function storeNumberField(spec: NumberFieldSpec, display: number): number {
	const scale = spec.displayScale ?? 1;
	const clamped = Math.min(spec.max, Math.max(spec.min, display));
	return Math.round((clamped / scale) * 10000) / 10000;
}

/** stored value -> display units */
export function displayNumberField(spec: NumberFieldSpec, stored: number): number {
	const scale = spec.displayScale ?? 1;
	return Math.round(stored * scale * 100) / 100;
}

/** custom rows that need imperative UI on both render paths; the tab
 *  supplies these so the definitions stay pure data for the drift guard */
export interface SettingRenderHooks {
	renderModifiers: (setting: Setting) => void;
	renderZoomKey: (setting: Setting) => void;
}

export interface DefinitionEntry {
	name: string;
	desc?: string;
	aliases?: string[];
	control?: SettingControl;
	render?: (setting: Setting) => void;
}

export interface DefinitionGroup {
	type: "group";
	heading: string;
	items: DefinitionEntry[];
}

export const ZOOM_KEY_DESC =
	"Hold this key and scroll over an open preview to zoom it. Off disables scroll zoom.";

/**
 * The single source of truth for the settings tab. Obsidian 1.13+ renders
 * the tab declaratively from these definitions and indexes them for the
 * settings search; display() is NEVER called there once
 * getSettingDefinitions() returns a non-empty array (obsidian.d.ts,
 * SettingTab.display). Pre-1.13 renders via display(), which is an
 * interpreter over these same definitions. Custom rows (the modifier
 * button row, the conflict-aware zoom key dropdown) are render callbacks
 * executed by BOTH paths, so no behavior can live on one path only.
 */
export function settingDefinitions(hooks: SettingRenderHooks): DefinitionGroup[] {
	const number = (key: NumberFieldKey) => {
		const spec = NUMBER_FIELDS[key];
		return {
			type: "number" as const,
			key,
			min: spec.min,
			max: spec.max,
			step: spec.step,
			defaultValue: displayNumberField(spec, DEFAULT_SETTINGS[key]),
		};
	};

	return [
		{
			type: "group",
			heading: "Trigger",
			items: [
				{
					name: "Hold to trigger",
					desc:
						"Modifiers that must be held while hovering for the preview to open. " +
						"Select none to trigger on plain hover; select several to require the combination.",
					aliases: ["modifiers", "ctrl", "alt", "shift", "cmd", "hotkey"],
					render: hooks.renderModifiers,
				},
				{
					name: "Close on modifier release",
					desc:
						"Close the preview as soon as a required modifier is released. Only applies " +
						"when modifiers are selected above. Pinned previews and previews you " +
						"have clicked into stay open.",
					control: {
						type: "toggle",
						key: "closeOnModifierRelease",
						defaultValue: DEFAULT_SETTINGS.closeOnModifierRelease,
					},
				},
				{
					name: "Hover delay",
					desc: "How long the pointer must rest on a link before the preview opens (ms).",
					control: number("hoverDelay"),
				},
				{
					name: "Stillness delay",
					desc:
						"Extra guard against accidental triggers: pointer movement over the link restarts " +
						"this countdown, so the preview only opens once the pointer holds still (ms, 0 = off).",
					control: number("stillnessDelay"),
				},
			],
		},
		{
			type: "group",
			heading: "Dismissal",
			items: [
				{
					name: "Dismissal mode",
					desc:
						"Hover: closes shortly after the pointer leaves the link or popover. " +
						"Sticky: stays open until a click anywhere else. In either mode, the " +
						"pin button on a preview keeps it open until you close it yourself.",
					control: {
						type: "dropdown",
						key: "stickyMode",
						options: {
							hover: "Close when pointer leaves",
							sticky: "Sticky (click elsewhere to close)",
						},
						defaultValue: DEFAULT_SETTINGS.stickyMode,
					},
				},
				{
					name: "Close on Escape",
					desc:
						"Escape closes the preview, including pinned previews. Turn this off if " +
						"you use Vim key bindings, where Escape is part of typing and would " +
						"keep dismissing a pinned preview.",
					control: {
						type: "toggle",
						key: "closeOnEscape",
						defaultValue: DEFAULT_SETTINGS.closeOnEscape,
					},
				},
				{
					name: "Hide grace period",
					desc: "How long the preview lingers after the pointer leaves it (ms).",
					control: number("hideDelay"),
				},
			],
		},
		{
			type: "group",
			heading: "Preview",
			items: [
				{
					name: "Preview mode",
					desc:
						"Auto uses a live page preview on desktop and a metadata card on mobile. " +
						"Reader extracts and shows just the article text, in your theme, with no scripts. " +
						"Card is the lightest option. Anything that fails falls back to the card.",
					control: {
						type: "dropdown",
						key: "renderMode",
						options: {
							auto: "Auto",
							webview: "Live page (desktop only)",
							reader: "Reader",
							card: "Metadata card",
						},
						defaultValue: DEFAULT_SETTINGS.renderMode,
					},
				},
				{
					name: "Embedded players",
					desc:
						"In Auto mode, links to supported media (YouTube, Vimeo, Spotify, SoundCloud) " +
						"load the provider's embedded player instead of the full page. " +
						"Set host: webview in the per-domain modes below to force the full page for a site.",
					control: {
						type: "toggle",
						key: "enableEmbeds",
						defaultValue: DEFAULT_SETTINGS.enableEmbeds,
					},
				},
				{
					name: "Media volume",
					desc:
						"Playback volume for media inside previews, in percent (0 to 100). Also " +
						"adjustable by hovering the speaker button on an open preview.",
					control: number("mediaVolume"),
				},
				{
					name: "Popover width",
					desc: "Default width (px). You can also drag the popover's edges to resize it.",
					control: number("popoverWidth"),
				},
				{
					name: "Popover height",
					desc: "Default height (px).",
					control: number("popoverHeight"),
				},
				{
					name: "Remember resized size",
					desc: "After dragging the popover edges, keep that size as the new default.",
					control: {
						type: "toggle",
						key: "persistResize",
						defaultValue: DEFAULT_SETTINGS.persistResize,
					},
				},
				{
					name: "Page zoom",
					desc: "Zoom for the live page preview, in percent (25 to 150).",
					control: number("webviewZoom"),
				},
				{
					name: "Zoom key",
					desc: ZOOM_KEY_DESC,
					aliases: ["zoom", "scroll"],
					render: hooks.renderZoomKey,
				},
			],
		},
		{
			type: "group",
			heading: "Privacy",
			items: [
				{
					name: "Remember preview logins",
					desc:
						"Live previews browse in their own cookie storage, separate from Obsidian " +
						"and from your system browser; Hoverlay itself never reads or stores " +
						"credentials. Off: anything you sign into inside a preview stays signed " +
						"in only until you quit Obsidian, and nothing is written to disk. On: " +
						"Electron keeps preview cookies on disk so logins survive restarts. " +
						"Switching either way starts previews from a fresh cookie jar; it does " +
						"not erase data already saved.",
					control: {
						type: "toggle",
						key: "persistLogins",
						defaultValue: DEFAULT_SETTINGS.persistLogins,
					},
				},
			],
		},
		{
			type: "group",
			heading: "Filtering",
			items: [
				{
					name: "Blocked domains",
					desc: "Never preview these hosts. One per line, e.g. example.com (also matches sub.example.com).",
					control: {
						type: "textarea",
						key: "domainBlocklist",
						placeholder: "example.com",
						defaultValue: DEFAULT_SETTINGS.domainBlocklist,
					},
				},
				{
					name: "Per-domain preview mode",
					desc:
						"Override the preview mode for specific hosts. One per line as host: mode, " +
						"where mode is auto, webview, reader, card or embed. Subdomains match; the most " +
						"specific entry wins. webview forces the full page even for media links; " +
						"embed forces the embedded player even when the global toggle is off. " +
						"Example: heavysite.com: card",
					control: {
						type: "textarea",
						key: "domainModes",
						placeholder: "example.com: reader",
						defaultValue: DEFAULT_SETTINGS.domainModes,
					},
				},
			],
		},
	];
}

export class HoverlaySettingTab extends PluginSettingTab {
	plugin: HoverlayPlugin;

	constructor(app: App, plugin: HoverlayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** always-visible numeric field with native up/down steppers, clamped on
	 *  change; bounds come from NUMBER_FIELDS, shared with the declarative
	 *  setting definitions */
	private addNumberField(setting: Setting, key: NumberFieldKey): void {
		const spec = NUMBER_FIELDS[key];
		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = String(spec.min);
			text.inputEl.max = String(spec.max);
			text.inputEl.step = String(spec.step);
			text.inputEl.addClass("hoverlay-number-input");
			text.setValue(String(displayNumberField(spec, this.plugin.settings[key])));
			text.onChange(async (value) => {
				const parsed = Number(value);
				if (!Number.isFinite(parsed)) return;
				await this.setControlValue(key, parsed);
			});
		});
	}

	/** hooks bound to this tab; BOTH render paths execute them */
	private renderHooks(): SettingRenderHooks {
		return {
			renderModifiers: (setting) => this.renderModifierButtons(setting),
			renderZoomKey: (setting) => this.renderZoomKeySetting(setting),
		};
	}

	/** Obsidian 1.13+ renders and search-indexes the tab from these. The
	 *  entry shapes are structurally valid SettingDefinitionItems; the cast
	 *  bridges the union's optional-never members, and the rendered-tab e2e
	 *  assertion is the runtime guarantee that 1.13 accepts them */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return settingDefinitions(this.renderHooks()) as unknown as SettingDefinitionItem[];
	}

	/** re-render whichever path is live: 1.13+ re-renders the definitions
	 *  via update() (display() is dead there); older versions re-run the
	 *  display() interpreter. requireApiVersion is the guard form the
	 *  plugin-review scanner recognizes (a typeof feature-check reads as an
	 *  unguarded 1.13 API call and fails the review) */
	private refreshTab(): void {
		if (requireApiVersion("1.13.0")) this.update();
		else this.display();
	}

	/** percent-presented factors (media volume, page zoom) are stored as
	 *  0..1 factors; translate for the declarative controls */
	getControlValue(key: string): unknown {
		const value = this.plugin.settings[key as keyof HoverlaySettings];
		const spec = NUMBER_FIELDS[key as NumberFieldKey] as NumberFieldSpec | undefined;
		if (spec && typeof value === "number") return displayNumberField(spec, value);
		return value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		const spec = NUMBER_FIELDS[key as NumberFieldKey] as NumberFieldSpec | undefined;
		settings[key] =
			spec && typeof value === "number" ? storeNumberField(spec, value) : value;
		// saveSettings also refreshes the derived blocklist/domain-rule caches
		await this.plugin.saveSettings();
		// zoom key availability depends on this toggle; re-render so the
		// zoom dropdown re-evaluates its conflicts
		if (key === "closeOnModifierRelease") this.refreshTab();
	}

	/** pre-1.13 rendering: interpret the same definitions imperatively.
	 *  Obsidian 1.13+ never calls this (non-empty getSettingDefinitions). */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const group of settingDefinitions(this.renderHooks())) {
			new Setting(containerEl).setHeading().setName(group.heading);
			for (const item of group.items) this.renderEntry(containerEl, item);
		}
	}

	private renderEntry(containerEl: HTMLElement, item: DefinitionEntry): void {
		const setting = new Setting(containerEl).setName(item.name);
		if (item.desc) setting.setDesc(item.desc);
		if (item.render) {
			item.render(setting);
			return;
		}
		const control = item.control;
		if (!control) return;
		// only the control types the definitions actually use; the drift
		// guard asserts no definition strays outside this set
		switch (control.type) {
			case "toggle":
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.getControlValue(control.key) as boolean)
						.onChange((value) => void this.setControlValue(control.key, value))
				);
				return;
			case "dropdown":
				setting.addDropdown((dropdown) => {
					for (const [value, label] of Object.entries(control.options)) {
						dropdown.addOption(value, label);
					}
					dropdown
						.setValue(this.getControlValue(control.key) as string)
						.onChange((value) => void this.setControlValue(control.key, value));
				});
				return;
			case "number":
				this.addNumberField(setting, control.key as NumberFieldKey);
				return;
			case "textarea":
				setting.addTextArea((text) =>
					text
						.setPlaceholder(control.placeholder ?? "")
						.setValue(this.getControlValue(control.key) as string)
						.onChange((value) => void this.setControlValue(control.key, value))
				);
				return;
		}
	}

	/** the modifier button row; shared by the declarative renderer (1.13+)
	 *  and the display() interpreter */
	private renderModifierButtons(setting: Setting): void {
		for (const mod of ["ctrl", "alt", "shift", "meta"] as ModifierKey[]) {
			setting.addButton((button) => {
				button.setButtonText(MODIFIER_LABELS[mod]);
				if (this.plugin.settings.modifiers.includes(mod)) button.setCta();
				button.onClick(async () => {
					const current = this.plugin.settings.modifiers;
					this.plugin.settings.modifiers = current.includes(mod)
						? current.filter((m) => m !== mod)
						: [...current, mod];
					await this.plugin.saveSettings();
					this.refreshTab(); // button highlights and zoom key availability
				});
			});
		}
	}

	/** the conflict-aware zoom key dropdown; shared by both render paths.
	 *  With close-on-modifier-release, trigger keys are held for the
	 *  popover's whole life, so they can't double as the zoom key; migrate
	 *  a conflicting stored choice to a free key, or to Off when none remain */
	private renderZoomKeySetting(setting: Setting): void {
		const { modifiers, closeOnModifierRelease } = this.plugin.settings;
		const conflictsApply = closeOnModifierRelease && modifiers.length > 0;
		const resolvedZoom = resolveZoomModifier(
			this.plugin.settings.zoomModifier,
			modifiers,
			closeOnModifierRelease
		);
		if (this.plugin.settings.zoomModifier !== "none") {
			const migrated = resolvedZoom ?? "none";
			if (migrated !== this.plugin.settings.zoomModifier) {
				this.plugin.settings.zoomModifier = migrated;
				void this.plugin.saveSettings();
			}
		}

		if (conflictsApply) {
			setting.setDesc(
				ZOOM_KEY_DESC +
					" Keys used by your trigger combination are unavailable while close on modifier release is on."
			);
		}

		setting.addDropdown((dropdown) => {
			const conflicted = (option: ZoomModifier) =>
				conflictsApply && zoomConflictsWithTriggers(option, modifiers);
			const label = (text: string, option: ZoomModifier) =>
				conflicted(option) ? `${text} (used by trigger)` : text;

			dropdown
				.addOption("ctrl", label("Ctrl/Cmd", "ctrl"))
				.addOption("alt", label("Alt", "alt"))
				.addOption("shift", label("Shift", "shift"))
				.addOption("none", "Off")
				.setValue(this.plugin.settings.zoomModifier)
				.onChange(async (value) => {
					this.plugin.settings.zoomModifier = value as ZoomModifier;
					await this.plugin.saveSettings();
				});

			dropdown.selectEl.addClass("hoverlay-zoom-select");
			if (conflictsApply) {
				dropdown.selectEl.title =
					"Keys held by your trigger combination cannot zoom while close on modifier release is on.";
				for (const option of Array.from(dropdown.selectEl.options)) {
					option.disabled = conflicted(option.value as ZoomModifier);
				}
			}
		});
	}
}
