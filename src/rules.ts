/**
 * Pure decision helpers (modifier matching, domain blocking). No Obsidian or
 * DOM imports, so everything here is unit-testable in plain Node.
 */

export type ModifierKey = "ctrl" | "alt" | "shift" | "meta";
export type RenderMode = "auto" | "webview" | "reader" | "card";

export interface ModifierState {
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}

export function modifiersHeld(evt: ModifierState, required: ModifierKey[]): boolean {
	return required.every((mod) => {
		switch (mod) {
			case "ctrl":
				return evt.ctrlKey;
			case "alt":
				return evt.altKey;
			case "shift":
				return evt.shiftKey;
			case "meta":
				return evt.metaKey;
		}
	});
}

export type ZoomModifier = "ctrl" | "alt" | "shift";

const ZOOM_OPTIONS: ZoomModifier[] = ["ctrl", "alt", "shift"];

export function zoomConflictsWithTriggers(
	option: ZoomModifier,
	triggers: ModifierKey[]
): boolean {
	switch (option) {
		case "ctrl":
			// the ctrl option also reacts to Cmd/Meta, so a meta trigger conflicts too
			return triggers.includes("ctrl") || triggers.includes("meta");
		case "alt":
			return triggers.includes("alt");
		case "shift":
			return triggers.includes("shift");
	}
}

/**
 * With close-on-modifier-release, the trigger keys are held for the whole
 * life of the popover; if the zoom key were one of them, the zoom shield
 * would be up permanently and block all interaction with the page. Resolve
 * to a non-conflicting key, or null when every option conflicts (zoom is
 * disabled entirely in that configuration).
 */
export function resolveZoomModifier(
	preferred: ZoomModifier,
	triggers: ModifierKey[],
	closeOnRelease: boolean
): ZoomModifier | null {
	if (!closeOnRelease || triggers.length === 0) return preferred;
	if (!zoomConflictsWithTriggers(preferred, triggers)) return preferred;
	return ZOOM_OPTIONS.find((option) => !zoomConflictsWithTriggers(option, triggers)) ?? null;
}

export function getBlockedHosts(blocklist: string): string[] {
	return blocklist
		.split("\n")
		.map((line) => line.trim().toLowerCase())
		.filter((line) => line.length > 0);
}

export function isHostBlocked(hostname: string, blocked: string[]): boolean {
	const host = hostname.toLowerCase();
	return blocked.some((entry) => host === entry || host.endsWith("." + entry));
}

/** per-domain entries accept every render mode plus "embed", which forces
 *  the embedded-player transform for that host even when the global embed
 *  toggle is off */
export type DomainMode = RenderMode | "embed";

export interface DomainModeRule {
	host: string;
	mode: DomainMode;
}

const DOMAIN_MODES = new Set<string>(["auto", "webview", "reader", "card", "embed"]);

/** parse "host: mode" lines; unknown modes and malformed lines are ignored */
export function parseDomainModes(text: string): DomainModeRule[] {
	const rules: DomainModeRule[] = [];
	for (const line of text.split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const host = line.slice(0, separator).trim().toLowerCase();
		const mode = line.slice(separator + 1).trim().toLowerCase();
		if (!host || !DOMAIN_MODES.has(mode)) continue;
		rules.push({ host, mode: mode as DomainMode });
	}
	return rules;
}

/** subdomains match their parent entries; the most specific entry wins */
export function matchDomainMode(hostname: string, rules: DomainModeRule[]): DomainMode | null {
	const host = hostname.toLowerCase();
	let best: DomainModeRule | null = null;
	for (const rule of rules) {
		if (host !== rule.host && !host.endsWith("." + rule.host)) continue;
		if (!best || rule.host.length > best.host.length) best = rule;
	}
	return best?.mode ?? null;
}
