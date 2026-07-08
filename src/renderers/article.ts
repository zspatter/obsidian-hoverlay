/**
 * Article HTML post-processing for reader mode: sanitization and URL
 * resolution. Separated from the reader renderer because this is the
 * security-relevant part and deserves direct tests.
 */
import DOMPurify from "dompurify";

/** strip everything executable or embeddable; the reader shows text. Returns
 *  a detached fragment so callers append nodes instead of writing HTML
 *  strings into the DOM. */
export function sanitizeArticleFragment(html: string): DocumentFragment {
	return DOMPurify.sanitize(html, {
		FORBID_TAGS: [
			"iframe", "form", "input", "button", "select", "textarea",
			"object", "embed", "video", "audio", "source", "style", "svg", "math",
		],
		FORBID_ATTR: ["style", "srcset", "sizes"],
		RETURN_DOM_FRAGMENT: true,
	});
}

/**
 * The extracted fragment lives in our document, so relative URLs must be
 * resolved against the article's origin by hand. Unresolvable images are
 * removed; unresolvable link targets are stripped but keep their text.
 */
export function absolutizeArticleUrls(root: HTMLElement, baseUrl: string): void {
	for (const img of Array.from(root.querySelectorAll("img"))) {
		const src = img.getAttribute("src");
		try {
			if (!src) throw new Error();
			img.setAttribute("src", new URL(src, baseUrl).href);
		} catch {
			img.remove();
		}
	}
	for (const anchor of Array.from(root.querySelectorAll("a"))) {
		const href = anchor.getAttribute("href");
		try {
			if (!href) throw new Error();
			anchor.setAttribute("href", new URL(href, baseUrl).href);
		} catch {
			anchor.removeAttribute("href");
		}
	}
}
