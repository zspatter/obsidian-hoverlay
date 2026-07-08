/**
 * Fallback renderer: OpenGraph metadata card.
 *
 * Used on mobile (no webview there) and whenever the webview fails to load.
 * Fetches the page over requestUrl (main-process request, immune to CORS)
 * and renders title / description / image / favicon as a compact card.
 */
import { fetchMetadata } from "../metadata";
import type { RendererHandle } from "./types";

export function renderCard(container: HTMLElement, url: string): RendererHandle {
	let cancelled = false;

	const card = container.createDiv({ cls: "hoverlay-card" });
	const loading = card.createDiv({ cls: "hoverlay-loading" });
	loading.createDiv({ cls: "hoverlay-spinner" });

	void fetchMetadata(url).then((meta) => {
		if (cancelled) return;
		card.empty();

		if (meta.image) {
			const imageWrapper = card.createDiv({ cls: "hoverlay-card-image" });
			imageWrapper.createEl("img", { attr: { src: meta.image, alt: "" } });
		}

		const body = card.createDiv({ cls: "hoverlay-card-body" });
		body.createDiv({ cls: "hoverlay-card-title", text: meta.title });
		if (meta.description) {
			body.createDiv({ cls: "hoverlay-card-description", text: meta.description });
		}

		const footer = body.createDiv({ cls: "hoverlay-card-footer" });
		if (meta.favicon) {
			footer.createEl("img", {
				cls: "hoverlay-card-favicon",
				attr: { src: meta.favicon, alt: "" },
			});
		}
		footer.createSpan({ text: meta.hostname });
	});

	return {
		dispose: () => {
			cancelled = true;
			card.remove();
		},
	};
}
