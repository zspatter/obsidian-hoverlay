/**
 * Reader renderer: article extraction, rendered in-theme.
 *
 * The private middle ground between the live page and the metadata card:
 * fetches the HTML over requestUrl (main-process, CORS-immune), runs
 * Mozilla Readability to extract the article, sanitizes it with DOMPurify,
 * and renders the text using the vault's own typography. No scripts or
 * trackers ever execute; images load only when the article contains them.
 */
import { requestUrl } from "obsidian";
import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import { BROWSER_UA } from "../metadata";
import type { RendererHandle } from "./types";

export function renderReader(
	container: HTMLElement,
	url: string,
	onFail: () => void
): RendererHandle {
	let cancelled = false;

	const root = container.createDiv({ cls: "hoverlay-reader" });
	const loading = root.createDiv({ cls: "hoverlay-loading" });
	loading.createDiv({ cls: "hoverlay-spinner" });

	void (async () => {
		let html: string;
		try {
			const response = await requestUrl({
				url,
				method: "GET",
				throw: false,
				headers: { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml" },
			});
			if (cancelled) return;
			if (response.status >= 400) {
				onFail();
				return;
			}
			html = response.text;
		} catch {
			if (!cancelled) onFail();
			return;
		}

		const doc = new DOMParser().parseFromString(html, "text/html");
		const article = new Readability(doc, { keepClasses: false }).parse();
		if (cancelled) return;
		if (!article?.content) {
			onFail(); // not an article-shaped page; the card is a better fit
			return;
		}

		loading.remove();
		root.createDiv({ cls: "hoverlay-reader-title", text: article.title ?? url });
		if (article.byline) {
			root.createDiv({ cls: "hoverlay-reader-byline", text: article.byline });
		}

		const body = root.createDiv({ cls: "hoverlay-reader-body" });
		body.innerHTML = DOMPurify.sanitize(article.content, {
			FORBID_TAGS: [
				"iframe", "form", "input", "button", "select", "textarea",
				"object", "embed", "video", "audio", "source", "style", "svg", "math",
			],
			FORBID_ATTR: ["style", "srcset", "sizes"],
		});

		// the extracted fragment lives in our document now, so relative URLs
		// must be resolved against the article's origin by hand
		for (const img of Array.from(body.querySelectorAll("img"))) {
			const src = img.getAttribute("src");
			try {
				if (!src) throw new Error();
				img.setAttribute("src", new URL(src, url).href);
			} catch {
				img.remove();
			}
		}
		for (const anchor of Array.from(body.querySelectorAll("a"))) {
			const href = anchor.getAttribute("href");
			try {
				if (!href) throw new Error();
				anchor.setAttribute("href", new URL(href, url).href);
			} catch {
				anchor.removeAttribute("href");
			}
		}

		// links inside the article open externally instead of navigating anything
		body.addEventListener("click", (evt) => {
			const anchor = evt.target instanceof Element ? evt.target.closest("a") : null;
			const href = anchor?.getAttribute("href");
			if (href) {
				evt.preventDefault();
				window.open(href);
			}
		});
	})();

	return {
		dispose: () => {
			cancelled = true;
			root.remove();
		},
	};
}
