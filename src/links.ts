/**
 * Pure link-extraction and normalization logic. No Obsidian or DOM imports,
 * so everything here is unit-testable in plain Node.
 */

const HTTP_PATTERN = /^https?:\/\//i;
const OTHER_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
// bare-domain heuristic for scheme-less links: "www.foo.com", "foo.com/path"
const DOMAIN_PATTERN = /^(?:[\w-]+\.)+[a-z]{2,}(?:[:/?#].*)?$/i;
// markdown inline link [label](url "title") and raw/auto-linked URLs, for editor
// line scans. Backticks are excluded everywhere: they're not valid raw URL
// characters, and URLs inside `code spans` would otherwise capture the closing
// backtick and load as ...%60
const MD_LINK_PATTERN = /\[[^\]]*\]\(\s*<?([^)\s>`]+)>?[^)]*\)/g;
const RAW_URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/g;
// scheme-less, www-less candidates in plain text ("github.com/zspatter");
// gated behind the known-TLD list below so prose like "file.txt" never matches
const BARE_URL_PATTERN = /(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`)\]]*)?/gi;

/**
 * TLDs accepted for scheme-less link targets and bare domains in text. This
 * is deliberately an allowlist: "file.txt", "readme.md" and "meeting.notes"
 * all parse as domains, and only a TLD list separates web links from file
 * names and note titles. Never add file-extension lookalikes (md, txt, png).
 */
export const KNOWN_TLDS = new Set([
	"com", "org", "net", "io", "dev", "app", "ai", "co", "me", "sh", "gg",
	"tv", "fm", "to", "xyz", "info", "biz", "edu", "gov", "mil", "int", "eu",
	"uk", "de", "fr", "es", "it", "nl", "be", "ch", "at", "se", "no", "dk",
	"fi", "pl", "cz", "pt", "ie", "ru", "ua", "jp", "cn", "kr", "in", "au",
	"nz", "ca", "us", "br", "mx", "za", "wiki", "blog", "news", "site",
	"tech", "cloud", "store", "online", "live", "studio", "world", "zone",
	"chat", "codes", "tools", "host", "page", "run", "fyi", "lol", "cafe",
	"team", "group", "club", "fun", "pro", "one", "top", "cc", "ws",
]);

function hasKnownTld(target: string): boolean {
	const host = target.split(/[/?#:]/)[0];
	const tld = host.slice(host.lastIndexOf(".") + 1).toLowerCase();
	return KNOWN_TLDS.has(tld);
}

/**
 * Turn a raw link target into a previewable https URL, or null if it isn't
 * an external web link.
 *
 * Scheme-less targets are ambiguous: "www.foo.com" is clearly a web link,
 * but "meeting.notes" or "readme.md" may be files in the vault, and the
 * domain heuristic alone can't tell. Two gates apply: the TLD must be on
 * the known list, and the optional isVaultPath callback lets the caller
 * resolve the target against the actual vault; anything it claims is
 * internal is skipped.
 */
export function normalizeUrl(
	raw: string,
	isVaultPath?: (target: string) => boolean
): string | null {
	const value = raw.trim();
	if (!value) return null;
	if (HTTP_PATTERN.test(value)) return value;
	if (OTHER_SCHEME_PATTERN.test(value)) return null; // obsidian://, mailto:, app://...
	if (!DOMAIN_PATTERN.test(value)) return null;
	if (!hasKnownTld(value)) return null;
	if (isVaultPath?.(value)) return null;
	return "https://" + value;
}

/** find a link whose text range covers the given offset within a doc line */
export function findLinkAtOffset(text: string, offset: number): string | null {
	for (const pattern of [MD_LINK_PATTERN, RAW_URL_PATTERN]) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			if (offset >= match.index && offset < match.index + match[0].length) {
				return match[1] ?? match[0];
			}
		}
	}

	// bare domains: require a boundary before the match (rules out the domain
	// part of emails and tails of already-handled URLs) and a known TLD
	BARE_URL_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = BARE_URL_PATTERN.exec(text)) !== null) {
		if (offset < match.index || offset >= match.index + match[0].length) continue;
		const prev = match.index > 0 ? text[match.index - 1] : "";
		if (prev && /[\w@./:-]/.test(prev)) return null;
		return hasKnownTld(match[0]) ? match[0] : null;
	}
	return null;
}
