/**
 * Embed URL transforms: map media page URLs to the provider's embedded
 * player URL. Pure module, no Obsidian or DOM imports.
 *
 * This deliberately avoids the oEmbed API: for the providers that matter,
 * the embed URL is derivable from the page URL with a pure transform, and
 * the embed pages are designed to be framed (light, no cookie walls, no
 * scripts required on our side). Rich oEmbed payloads for other sites need
 * provider scripts we won't execute, so they aren't worth the surface.
 *
 * Deliberately excluded: Twitch (its player requires a `parent` domain
 * parameter and refuses standalone loads, which is what a webview
 * navigation is) and X/Twitter (embeds are inert without widgets.js).
 */

const SPOTIFY_TYPES = new Set(["track", "album", "playlist", "episode", "show", "artist"]);
const SOUNDCLOUD_RESERVED = new Set([
	"discover", "search", "stream", "upload", "you", "messages", "settings",
	"charts", "people", "tags", "pages",
]);

function isHost(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith("." + domain);
}

/** accepts "90", "90s" and "1h2m3s" forms; returns whole seconds or null */
function parseTimestamp(value: string): number | null {
	if (/^\d+s?$/.test(value)) return parseInt(value, 10);
	const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
	if (!match || (!match[1] && !match[2] && !match[3])) return null;
	return (
		Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
	);
}

function youTubeEmbed(id: string, source: URL): string | null {
	if (!/^[\w-]{6,}$/.test(id)) return null;
	const embed = new URL(`https://www.youtube.com/embed/${id}`);
	const list = source.searchParams.get("list");
	if (list) embed.searchParams.set("list", list);
	const timestamp = source.searchParams.get("t") ?? source.searchParams.get("start");
	if (timestamp) {
		const seconds = parseTimestamp(timestamp);
		if (seconds !== null) embed.searchParams.set("start", String(seconds));
	}
	return embed.href;
}

/** the provider's embedded player URL for a media page URL, or null when the
 *  URL isn't a recognized media page */
export function resolveEmbedUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;

	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	const segments = url.pathname.split("/").filter(Boolean);

	if (host === "youtu.be") {
		return segments[0] ? youTubeEmbed(segments[0], url) : null;
	}

	if (isHost(host, "youtube.com")) {
		if (url.pathname === "/watch") {
			const id = url.searchParams.get("v");
			return id ? youTubeEmbed(id, url) : null;
		}
		if ((segments[0] === "shorts" || segments[0] === "live") && segments[1]) {
			return youTubeEmbed(segments[1], url);
		}
		return null;
	}

	if (host === "vimeo.com") {
		const match = url.pathname.match(/^\/(\d+)$/);
		return match ? `https://player.vimeo.com/video/${match[1]}` : null;
	}

	if (host === "open.spotify.com") {
		const parts = [...segments];
		if (parts[0]?.startsWith("intl-")) parts.shift(); // locale-prefixed paths
		const [type, id] = parts;
		if (type && id && SPOTIFY_TYPES.has(type)) {
			return `https://open.spotify.com/embed/${type}/${id}`;
		}
		return null;
	}

	if (host === "soundcloud.com") {
		if (segments.length >= 2 && !SOUNDCLOUD_RESERVED.has(segments[0])) {
			const track = url.origin + url.pathname;
			return `https://w.soundcloud.com/player/?url=${encodeURIComponent(track)}`;
		}
		return null;
	}

	return null;
}
