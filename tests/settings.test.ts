import { describe, expect, it } from "vitest";
import {
	DEFAULT_SETTINGS,
	NUMBER_FIELDS,
	displayNumberField,
	settingDefinitions,
	storeNumberField,
} from "../src/settings";
import type { NumberFieldKey } from "../src/settings";

/** structural view of the definition tree, enough for the sweeps */
interface AnyControl {
	type: string;
	key: string;
	min?: number;
	max?: number;
	step?: number;
	options?: Record<string, string>;
	defaultValue?: unknown;
}
interface AnyItem {
	name?: string;
	desc?: string;
	control?: AnyControl;
	render?: unknown;
	type?: string;
	heading?: string;
	items?: AnyItem[];
}

const groups = settingDefinitions({
	renderModifiers: () => {},
	renderZoomKey: () => {},
}) as AnyItem[];
const leaves: AnyItem[] = groups.flatMap((g) => g.items ?? []);
const controls = leaves.filter((l) => l.control).map((l) => l.control!);

/** settings whose UI is a shared render callback, not a declarative control */
const RENDER_ENTRIES: Record<string, string> = {
	modifiers: "Hold to trigger",
	zoomModifier: "Zoom key",
};
/** unions rendered as dropdowns; option keys must cover exactly these values */
const EXPECTED_DROPDOWNS: Record<string, string[]> = {
	renderMode: ["auto", "webview", "reader", "card"],
	stickyMode: ["hover", "sticky"],
};
/** free-text multiline settings */
const EXPECTED_TEXTAREAS = ["domainBlocklist", "domainModes"];

describe("declarative setting definitions (drift guard)", () => {
	it("every settings key has exactly one control, except the custom render rows", () => {
		const keys = controls.map((c) => c.key).sort();
		const expected = Object.keys(DEFAULT_SETTINGS)
			.filter((k) => !(k in RENDER_ENTRIES))
			.sort();
		expect(keys).toEqual(expected);
	});

	it("the custom rows are render entries wired to the tab hooks", () => {
		for (const name of Object.values(RENDER_ENTRIES)) {
			const entry = leaves.find((l) => l.name === name);
			expect(entry, name).toBeDefined();
			expect(entry!.control, name).toBeUndefined();
			expect(typeof entry!.render, name).toBe("function");
		}
	});

	it("every control type is one the display() interpreter renders", () => {
		const supported = new Set(["toggle", "dropdown", "number", "textarea"]);
		for (const control of controls) {
			expect(supported.has(control.type), `${control.key}: ${control.type}`).toBe(true);
		}
	});

	it("every group has a heading; every item has a non-empty unique name", () => {
		for (const group of groups) {
			expect(group.type).toBe("group");
			expect(group.heading).toBeTruthy();
		}
		const names = leaves.map((l) => l.name);
		expect(names.every((n) => typeof n === "string" && n.length > 0)).toBe(true);
		expect(new Set(names).size).toBe(names.length);
	});

	it("control types match the settings model types (exhaustive)", () => {
		for (const control of controls) {
			const stored = DEFAULT_SETTINGS[control.key as keyof typeof DEFAULT_SETTINGS];
			if (typeof stored === "boolean") {
				expect(control.type, control.key).toBe("toggle");
				expect(control.defaultValue, control.key).toBe(stored);
			} else if (typeof stored === "number") {
				const spec = NUMBER_FIELDS[control.key as NumberFieldKey];
				expect(spec, control.key).toBeDefined();
				expect(control.type, control.key).toBe("number");
				// bounds in display units, straight from the shared spec table
				expect(control.min, control.key).toBe(spec.min);
				expect(control.max, control.key).toBe(spec.max);
				expect(control.step, control.key).toBe(spec.step);
				expect(control.defaultValue, control.key).toBe(displayNumberField(spec, stored));
			} else if (control.key in EXPECTED_DROPDOWNS) {
				expect(control.type, control.key).toBe("dropdown");
				expect(Object.keys(control.options!).sort(), control.key).toEqual(
					EXPECTED_DROPDOWNS[control.key].sort()
				);
				expect(control.defaultValue, control.key).toBe(stored);
				expect(control.options![stored as string], control.key).toBeTruthy();
			} else {
				expect(EXPECTED_TEXTAREAS, control.key).toContain(control.key);
				expect(control.type, control.key).toBe("textarea");
				expect(control.defaultValue, control.key).toBe(stored);
			}
		}
	});

	it("every number field key appears in the definitions", () => {
		const numberKeys = controls.filter((c) => c.type === "number").map((c) => c.key);
		expect(numberKeys.sort()).toEqual(Object.keys(NUMBER_FIELDS).sort());
	});
});

describe("number field conversion (exhaustive per spec)", () => {
	it("round-trips every in-range step and clamps everything outside", () => {
		for (const [key, spec] of Object.entries(NUMBER_FIELDS)) {
			for (let display = spec.min; display <= spec.max; display += spec.step) {
				const stored = storeNumberField(spec, display);
				expect(displayNumberField(spec, stored), `${key}@${display}`).toBe(display);
			}
			expect(storeNumberField(spec, spec.min - 1000), key).toBe(
				storeNumberField(spec, spec.min)
			);
			expect(storeNumberField(spec, spec.max + 1000), key).toBe(
				storeNumberField(spec, spec.max)
			);
		}
	});

	it("percent factors store without float dust", () => {
		expect(storeNumberField(NUMBER_FIELDS.mediaVolume, 65)).toBe(0.65);
		expect(storeNumberField(NUMBER_FIELDS.webviewZoom, 65)).toBe(0.65);
		expect(displayNumberField(NUMBER_FIELDS.mediaVolume, 0.65)).toBe(65);
		expect(storeNumberField(NUMBER_FIELDS.popoverWidth, 480)).toBe(480);
	});
});
