import { describe, expect, it } from "vitest";
import {
	GUEST_POINTER_MSG,
	KEY_MSG_PREFIX,
	NAV_BACK_MSG,
	NAV_FORWARD_MSG,
	applyVolumeJs,
	guestBootstrapJs,
	parseGuestKeyMessage,
	scrollbarCss,
} from "../src/guest-scripts";

describe("applyVolumeJs", () => {
	it("embeds the clamped level for any input", () => {
		expect(applyVolumeJs(0.5)).toContain("= 0.5;");
		expect(applyVolumeJs(2)).toContain("= 1;");
		expect(applyVolumeJs(-3)).toContain("= 0;");
	});

	it("never emits a non-finite literal", () => {
		for (const bad of [NaN, Infinity, -Infinity]) {
			const script = applyVolumeJs(bad);
			expect(script).toContain("= 1;");
			expect(script).not.toContain("NaN");
			expect(script).not.toContain("Infinity");
		}
	});
});

describe("guestBootstrapJs", () => {
	it("contains the nav bridge tokens, the volume hook and the level", () => {
		const script = guestBootstrapJs(0.65);
		expect(script).toContain(NAV_BACK_MSG);
		expect(script).toContain(NAV_FORWARD_MSG);
		expect(script).toContain("__hoverlayVolumeHook");
		expect(script).toContain("0.65");
	});

	it("forwards Escape and the modifier keys over the key channel", () => {
		const script = guestBootstrapJs(1);
		expect(script).toContain(`${KEY_MSG_PREFIX}down:`);
		expect(script).toContain(`${KEY_MSG_PREFIX}up:`);
		for (const key of ["Escape", "Control", "Meta", "Alt", "Shift"]) {
			expect(script).toContain(`"${key}"`);
		}
	});

	it("reports guest mousedowns (the click evidence for focus acceptance)", () => {
		expect(guestBootstrapJs(1)).toContain(GUEST_POINTER_MSG);
	});
});

describe("parseGuestKeyMessage", () => {
	it("round-trips every forwarded key in both directions", () => {
		for (const direction of ["down", "up"] as const) {
			for (const key of ["Escape", "Control", "Meta", "Alt", "Shift"]) {
				expect(parseGuestKeyMessage(`${KEY_MSG_PREFIX}${direction}:${key}__`)).toEqual({
					direction,
					key,
				});
			}
		}
	});

	it("rejects everything else a guest may print", () => {
		for (const garbage of [
			"",
			"hello",
			NAV_BACK_MSG,
			NAV_FORWARD_MSG,
			KEY_MSG_PREFIX, // prefix alone
			`${KEY_MSG_PREFIX}down:__`, // empty key
			`${KEY_MSG_PREFIX}sideways:Escape__`, // bad direction
			`${KEY_MSG_PREFIX}down:Escape`, // missing terminator
			"__hoverlay:key-down:Escape", // same, spelled out
		]) {
			expect(parseGuestKeyMessage(garbage)).toBeNull();
		}
	});
});

describe("scrollbarCss", () => {
	it("embeds the provided theme colors", () => {
		const css = scrollbarCss({ bg: "#111", thumb: "#222", active: "#333" });
		expect(css).toContain("#111");
		expect(css).toContain("#222");
		expect(css).toContain("#333");
		expect(css).toContain("::-webkit-scrollbar");
	});
});
