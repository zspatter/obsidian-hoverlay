/**
 * Pure renderer selection: which presentation a URL gets, given settings,
 * per-domain rules and platform. Extracted from the popover manager so the
 * full mode/override/embed matrix is exhaustively unit-testable.
 */
import { matchDomainMode } from "./rules";
import type { DomainModeRule, RenderMode } from "./rules";
import { resolveEmbedUrl } from "./embeds";

export interface PresentationInput {
	url: string;
	renderMode: RenderMode;
	enableEmbeds: boolean;
	domainRules: DomainModeRule[];
	isDesktop: boolean;
}

export interface Presentation {
	kind: "webview" | "reader" | "card";
	/** what the webview actually loads (the embed player URL for embeds) */
	loadUrl: string;
	isEmbed: boolean;
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
	const embedUrl = embedWanted ? resolveEmbedUrl(url) : null;

	if ((mode === "auto" || mode === "webview") && isDesktop) {
		return { kind: "webview", loadUrl: embedUrl ?? url, isEmbed: embedUrl !== null };
	}
	if (mode === "reader") {
		return { kind: "reader", loadUrl: url, isEmbed: false };
	}
	return { kind: "card", loadUrl: url, isEmbed: false };
}
