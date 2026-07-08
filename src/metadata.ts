import { requestUrl } from "obsidian";

/** some sites gate OG tags and article HTML behind browser-looking user agents */
export const BROWSER_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface LinkMetadata {
	url: string;
	title: string;
	description: string;
	image: string | null;
	favicon: string | null;
	hostname: string;
}

/**
 * Small LRU for fetched metadata so re-hovering the same link is instant.
 * requestUrl goes through the main process, so CORS never applies; this is
 * the reason we parse OpenGraph ourselves instead of using a preview API.
 */
const CACHE_MAX = 100;
const cache = new Map<string, LinkMetadata>();

function cachePut(url: string, meta: LinkMetadata) {
	if (cache.has(url)) cache.delete(url);
	cache.set(url, meta);
	if (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}

function pickMeta(doc: Document, names: string[]): string | null {
	for (const name of names) {
		const el =
			doc.querySelector(`meta[property="${name}"]`) ??
			doc.querySelector(`meta[name="${name}"]`);
		const content = el?.getAttribute("content")?.trim();
		if (content) return content;
	}
	return null;
}

function resolveUrl(candidate: string | null, base: string): string | null {
	if (!candidate) return null;
	try {
		return new URL(candidate, base).href;
	} catch {
		return null;
	}
}

/** parse a page's HTML into preview metadata; exported for direct testing */
export function parseMetadata(html: string, url: string): LinkMetadata {
	const hostname = new URL(url).hostname;
	const doc = new DOMParser().parseFromString(html, "text/html");

	const title =
		pickMeta(doc, ["og:title", "twitter:title"]) ??
		doc.querySelector("title")?.textContent?.trim() ??
		url;
	const description =
		pickMeta(doc, ["og:description", "twitter:description", "description"]) ?? "";
	const image = resolveUrl(pickMeta(doc, ["og:image", "twitter:image"]), url);
	const faviconHref =
		doc.querySelector('link[rel="icon"]')?.getAttribute("href") ??
		doc.querySelector('link[rel="shortcut icon"]')?.getAttribute("href") ??
		"/favicon.ico";
	const favicon = resolveUrl(faviconHref, url);

	return { url, title, description, image, favicon, hostname };
}

export async function fetchMetadata(url: string): Promise<LinkMetadata> {
	const cached = cache.get(url);
	if (cached) return cached;

	const fallback: LinkMetadata = {
		url,
		title: url,
		description: "",
		image: null,
		favicon: null,
		hostname: new URL(url).hostname,
	};

	let html: string;
	try {
		const response = await requestUrl({
			url,
			method: "GET",
			throw: false,
			headers: {
				"user-agent": BROWSER_UA,
				accept: "text/html,application/xhtml+xml",
			},
		});
		if (response.status >= 400) return fallback;
		html = response.text;
	} catch {
		return fallback;
	}

	const meta = parseMetadata(html, url);
	cachePut(url, meta);
	return meta;
}
