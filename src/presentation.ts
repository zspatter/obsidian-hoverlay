/**
 * Pure renderer selection: which presentation a URL gets, given settings,
 * per-domain rules and platform. Extracted from the popover manager so the
 * full mode/override/embed matrix is exhaustively unit-testable.
 */
import { matchDomainMode } from "./rules";
import type { DomainModeRule, RenderMode } from "./rules";
import { resolveEmbed } from "./embeds";

export interface PresentationInput {
	url: string;
	renderMode: RenderMode;
	enableEmbeds: boolean;
	domainRules: DomainModeRule[];
	isDesktop: boolean;
}

/**
 * Referer declared when loading an embedded player. YouTube rejects embed
 * URLs that arrive with fetch metadata but no referrer (player error 153;
 * Obsidian's own webview sessions dodge this by stripping Sec-Fetch-Dest,
 * which our isolated partition cannot replicate from the renderer), so
 * every embed declares Obsidian as its embedding site. Never use the
 * provider's own origin: YouTube answers that with error 152, embedding
 * disallowed. Ordinary page previews send no referrer, like a browser
 * navigating from the address bar.
 */
export const EMBED_REFERRER = "https://obsidian.md/";

export interface Presentation {
	kind: "webview" | "reader" | "card";
	/** what the webview actually loads (the embed player URL for embeds) */
	loadUrl: string;
	isEmbed: boolean;
	/** the embed's natural sizing, for whitespace trimming */
	embedHint?: { height?: number; aspectRatio?: number };
	/** Referer for the webview load; present exactly for embeds */
	referrer?: string;
}

export function choosePresentation(input: PresentationInput): Presentation {
	const { url, renderMode, enableEmbeds, domainRules, isDesktop } = input;

	let host = "";
	try {
		host = new URL(url).hostname;
	} catch {
		// keep the global mode for unparseable hosts
	}
	const domainMode = host ? matchDomainMode(host, domainRules) : null;
	const mode = (domainMode === "embed" ? "auto" : domainMode) ?? renderMode;

	// in auto mode, media links load the provider's embedded player; an
	// explicit webview mode forces the raw page, and a per-domain "embed"
	// entry forces the player even with the global toggle off
	const embedWanted = domainMode === "embed" || (mode === "auto" && enableEmbeds);
	const embed = embedWanted ? resolveEmbed(url) : null;

	if ((mode === "auto" || mode === "webview") && isDesktop) {
		return {
			kind: "webview",
			loadUrl: embed?.url ?? url,
			isEmbed: embed !== null,
			embedHint: embed
				? { height: embed.height, aspectRatio: embed.aspectRatio }
				: undefined,
			referrer: embed ? EMBED_REFERRER : undefined,
		};
	}
	if (mode === "reader") {
		return { kind: "reader", loadUrl: url, isEmbed: false };
	}
	return { kind: "card", loadUrl: url, isEmbed: false };
}
