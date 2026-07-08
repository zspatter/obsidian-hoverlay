import { App, PluginSettingTab, Setting } from "obsidian";
import type HoverlayPlugin from "./main";
import { resolveZoomModifier, zoomConflictsWithTriggers } from "./rules";
import type { ModifierKey, RenderMode, ZoomModifier } from "./rules";

export type StickyMode = "hover" | "sticky";

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
	/** hover = closes when the pointer leaves; sticky = stays until Escape or a click elsewhere */
	stickyMode: StickyMode;
	popoverWidth: number;
	popoverHeight: number;
	/** remember the size after dragging the popover edges */
	persistResize: boolean;
	/** zoom factor applied to the webview so pages read like a thumbnail */
	webviewZoom: number;
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
	popoverWidth: 480,
	popoverHeight: 340,
	persistResize: true,
	webviewZoom: 0.65,
	zoomModifier: "ctrl",
	domainBlocklist: "",
	domainModes: "",
};

interface NumberFieldOptions {
	min: number;
	max: number;
	step: number;
	get: () => number;
	set: (value: number) => void;
}

export class HoverlaySettingTab extends PluginSettingTab {
	plugin: HoverlayPlugin;

	constructor(app: App, plugin: HoverlayPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** always-visible numeric field with native up/down steppers, clamped on change */
	private addNumberField(setting: Setting, opts: NumberFieldOptions): void {
		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = String(opts.min);
			text.inputEl.max = String(opts.max);
			text.inputEl.step = String(opts.step);
			text.inputEl.addClass("hoverlay-number-input");
			text.setValue(String(opts.get()));
			text.onChange(async (value) => {
				const parsed = Number(value);
				if (!Number.isFinite(parsed)) return;
				opts.set(Math.min(opts.max, Math.max(opts.min, parsed)));
				await this.plugin.saveSettings();
			});
		});
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ---- Trigger ----
		new Setting(containerEl).setHeading().setName("Trigger");

		const modifierSetting = new Setting(containerEl)
			.setName("Hold to trigger")
			.setDesc(
				"Modifiers that must be held while hovering for the preview to open. " +
					"Select none to trigger on plain hover; select several to require the combination."
			);
		for (const mod of ["ctrl", "alt", "shift", "meta"] as ModifierKey[]) {
			modifierSetting.addButton((button) => {
				button.setButtonText(MODIFIER_LABELS[mod]);
				if (this.plugin.settings.modifiers.includes(mod)) button.setCta();
				button.onClick(async () => {
					const current = this.plugin.settings.modifiers;
					this.plugin.settings.modifiers = current.includes(mod)
						? current.filter((m) => m !== mod)
						: [...current, mod];
					await this.plugin.saveSettings();
					this.display(); // refresh button highlight states
				});
			});
		}

		new Setting(containerEl)
			.setName("Close on modifier release")
			.setDesc(
				"Close the preview as soon as a required modifier is released. Only applies when modifiers are selected above."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.closeOnModifierRelease).onChange(async (value) => {
					this.plugin.settings.closeOnModifierRelease = value;
					await this.plugin.saveSettings();
					this.display(); // zoom key availability depends on this
				})
			);

		this.addNumberField(
			new Setting(containerEl)
				.setName("Hover delay")
				.setDesc("How long the pointer must rest on a link before the preview opens (ms)."),
			{
				min: 0,
				max: 3000,
				step: 50,
				get: () => this.plugin.settings.hoverDelay,
				set: (value) => (this.plugin.settings.hoverDelay = value),
			}
		);

		this.addNumberField(
			new Setting(containerEl)
				.setName("Stillness delay")
				.setDesc(
					"Extra guard against accidental triggers: pointer movement over the link restarts " +
						"this countdown, so the preview only opens once the pointer holds still (ms, 0 = off)."
				),
			{
				min: 0,
				max: 3000,
				step: 50,
				get: () => this.plugin.settings.stillnessDelay,
				set: (value) => (this.plugin.settings.stillnessDelay = value),
			}
		);

		// ---- Dismissal ----
		new Setting(containerEl).setHeading().setName("Dismissal");

		new Setting(containerEl)
			.setName("Dismissal mode")
			.setDesc(
				"Hover: closes shortly after the pointer leaves the link or popover. " +
					"Sticky: stays open until Escape or a click anywhere else. Escape always closes."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("hover", "Close when pointer leaves")
					.addOption("sticky", "Sticky (Escape or click elsewhere)")
					.setValue(this.plugin.settings.stickyMode)
					.onChange(async (value) => {
						this.plugin.settings.stickyMode = value as StickyMode;
						await this.plugin.saveSettings();
					})
			);

		this.addNumberField(
			new Setting(containerEl)
				.setName("Hide grace period")
				.setDesc("How long the preview lingers after the pointer leaves it (ms)."),
			{
				min: 100,
				max: 3000,
				step: 50,
				get: () => this.plugin.settings.hideDelay,
				set: (value) => (this.plugin.settings.hideDelay = value),
			}
		);

		// ---- Preview ----
		new Setting(containerEl).setHeading().setName("Preview");

		new Setting(containerEl)
			.setName("Preview mode")
			.setDesc(
				"Auto uses a live page preview on desktop and a metadata card on mobile. " +
					"Reader extracts and shows just the article text, in your theme, with no scripts. " +
					"Card is the lightest option. Anything that fails falls back to the card."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", "Auto")
					.addOption("webview", "Live page (desktop only)")
					.addOption("reader", "Reader")
					.addOption("card", "Metadata card")
					.setValue(this.plugin.settings.renderMode)
					.onChange(async (value) => {
						this.plugin.settings.renderMode = value as RenderMode;
						await this.plugin.saveSettings();
					})
			);

		this.addNumberField(
			new Setting(containerEl)
				.setName("Popover width")
				.setDesc("Default width (px). You can also drag the popover's edges to resize it."),
			{
				min: 260,
				max: 2000,
				step: 20,
				get: () => this.plugin.settings.popoverWidth,
				set: (value) => (this.plugin.settings.popoverWidth = value),
			}
		);

		this.addNumberField(
			new Setting(containerEl).setName("Popover height").setDesc("Default height (px)."),
			{
				min: 180,
				max: 1500,
				step: 20,
				get: () => this.plugin.settings.popoverHeight,
				set: (value) => (this.plugin.settings.popoverHeight = value),
			}
		);

		new Setting(containerEl)
			.setName("Remember resized size")
			.setDesc("After dragging the popover edges, keep that size as the new default.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.persistResize).onChange(async (value) => {
					this.plugin.settings.persistResize = value;
					await this.plugin.saveSettings();
				})
			);

		// with close-on-modifier-release, trigger keys are held for the popover's
		// whole life, so they can't double as the zoom key; migrate a conflicting
		// stored choice to a free key, or disable zoom when no key remains
		const { modifiers, closeOnModifierRelease } = this.plugin.settings;
		const conflictsApply = closeOnModifierRelease && modifiers.length > 0;
		const resolvedZoom = resolveZoomModifier(
			this.plugin.settings.zoomModifier,
			modifiers,
			closeOnModifierRelease
		);
		if (resolvedZoom !== null && resolvedZoom !== this.plugin.settings.zoomModifier) {
			this.plugin.settings.zoomModifier = resolvedZoom;
			void this.plugin.saveSettings();
		}
		const zoomDisabled = resolvedZoom === null;

		const pageZoomSetting = new Setting(containerEl)
			.setName("Page zoom")
			.setDesc("Zoom factor for the live page preview.");
		this.addNumberField(pageZoomSetting, {
			min: 0.25,
			max: 1.5,
			step: 0.05,
			get: () => this.plugin.settings.webviewZoom,
			set: (value) => (this.plugin.settings.webviewZoom = value),
		});

		let zoomKeyDesc = "Hold this key and scroll over an open preview to zoom it.";
		if (zoomDisabled) {
			zoomKeyDesc =
				"Zoom is disabled: every available key is used by your trigger combination " +
				"while close on modifier release is on.";
		} else if (conflictsApply) {
			zoomKeyDesc +=
				" Keys used by your trigger combination are unavailable while close on modifier release is on.";
		}

		const zoomKeySetting = new Setting(containerEl)
			.setName("Zoom key")
			.setDesc(zoomKeyDesc)
			.addDropdown((dropdown) => {
				const conflicted = (option: ZoomModifier) =>
					conflictsApply && zoomConflictsWithTriggers(option, modifiers);
				const label = (text: string, option: ZoomModifier) =>
					conflicted(option) ? `${text} (used by trigger)` : text;

				dropdown
					.addOption("ctrl", label("Ctrl/Cmd", "ctrl"))
					.addOption("alt", label("Alt", "alt"))
					.addOption("shift", label("Shift", "shift"))
					.setValue(resolvedZoom ?? this.plugin.settings.zoomModifier)
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

		if (zoomDisabled) {
			pageZoomSetting.setDisabled(true);
			zoomKeySetting.setDisabled(true);
			pageZoomSetting.settingEl.addClass("hoverlay-setting-disabled");
			zoomKeySetting.settingEl.addClass("hoverlay-setting-disabled");
		}

		// ---- Filtering ----
		new Setting(containerEl).setHeading().setName("Filtering");

		new Setting(containerEl)
			.setName("Blocked domains")
			.setDesc("Never preview these hosts. One per line, e.g. example.com (also matches sub.example.com).")
			.addTextArea((text) =>
				text
					.setPlaceholder("example.com")
					.setValue(this.plugin.settings.domainBlocklist)
					.onChange(async (value) => {
						this.plugin.settings.domainBlocklist = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Per-domain preview mode")
			.setDesc(
				"Override the preview mode for specific hosts. One per line as host: mode, " +
					"where mode is auto, webview, reader or card. Subdomains match; the most " +
					"specific entry wins. Example: heavysite.com: card"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("example.com: reader")
					.setValue(this.plugin.settings.domainModes)
					.onChange(async (value) => {
						this.plugin.settings.domainModes = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
