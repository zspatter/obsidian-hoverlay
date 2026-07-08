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
import { BROWSER_UA } from "../metadata";
import { absolutizeArticleUrls, sanitizeArticleFragment } from "./article";
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
		body.appendChild(sanitizeArticleFragment(article.content));
		absolutizeArticleUrls(body, url);

		// links inside the article open externally instead of navigating anything
		body.addEventListener("click", (evt) => {
			// nodeType, not instanceof: the popover may live in a pop-out window
			const target = evt.target as Node | null;
			const anchor =
				target && target.nodeType === 1 ? (target as Element).closest("a") : null;
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
