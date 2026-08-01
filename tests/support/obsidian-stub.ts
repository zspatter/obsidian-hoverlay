/**
 * Runtime stand-in for the "obsidian" package in tests. The real package is
 * types-only (no runtime entry), so Vitest aliases the module id here (see
 * vitest.config.ts). Only what the code under test touches at runtime.
 *
 * This folder holds test infrastructure, not tests: suites live in
 * *.test.ts files next to the modules they cover.
 */

// false forces the card renderer, the jsdom default; the guest-interaction
// suite in popover.test.ts flips this to reach the webview renderer
export const Platform = { isDesktopApp: false };

export function setIcon(): void {}

// jsdom suites exercise the pre-1.13 (display interpreter) path
export function requireApiVersion(): boolean {
	return false;
}

// minimal class shells so modules declaring settings tabs can be imported;
// suites exercising real tab behavior belong in the e2e tier
export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl = { empty: () => {} } as unknown;
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Setting {
	constructor(_containerEl: unknown) {}
	setHeading(): this {
		return this;
	}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	addText(): this {
		return this;
	}
	addToggle(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
	addTextArea(): this {
		return this;
	}
	addButton(): this {
		return this;
	}
}

export async function requestUrl(): Promise<{ status: number; text: string }> {
	return {
		status: 200,
		text: "<html><head><title>Stub</title></head><body></body></html>",
	};
}
