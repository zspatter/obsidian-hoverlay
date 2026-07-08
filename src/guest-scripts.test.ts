import { describe, expect, it } from "vitest";
import {
	NAV_BACK_MSG,
	NAV_FORWARD_MSG,
	applyVolumeJs,
	guestBootstrapJs,
	scrollbarCss,
} from "./guest-scripts";

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
