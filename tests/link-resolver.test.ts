// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { resolveLinkAt } from "../src/link-resolver";
import { normalizeUrl } from "../src/links";

const normalize = (raw: string) => (raw.startsWith("https://") ? raw : null);

/** a canvas card: content with anchors underneath, blocker on top */
function canvasCard(anchors: Array<{ href: string; cls?: string; rect: DOMRect }>): {
	blocker: HTMLElement;
} {
	const node = document.body.createDiv({ cls: "canvas-node" });
	const container = node.createDiv({ cls: "canvas-node-container" });
	const content = container.createDiv({ cls: "canvas-node-content" });
	for (const spec of anchors) {
		const a = content.createEl("a", { cls: spec.cls ?? "external-link" });
		a.setAttribute("href", spec.href);
		// jsdom does no layout; pin the rects the hit test reads
		a.getClientRects = () => [spec.rect] as unknown as DOMRectList;
	}
	const blocker = container.createDiv({ cls: "canvas-node-content-blocker" });
	return { blocker };
}

function mouseAt(x: number, y: number): MouseEvent {
	return new MouseEvent("mouseover", { clientX: x, clientY: y });
}

beforeAll(async () => {
	await import("./support/obsidian-dom");
});

/** a properties-panel value row, mirroring the probed Obsidian DOM: text
 *  properties wrap the link div in .metadata-link (with a pencil flair
 *  sibling), list properties wrap it in a .multi-select-pill (with a remove
 *  button sibling); the link classes and data-href live on the innermost
 *  content div in both shapes, never on an anchor */
function propertyRow(opts: {
	shape: "text" | "pill";
	cls: "external-link" | "internal-link";
	dataHref: string | null;
	text: string;
}): { linkEl: HTMLElement; sibling: HTMLElement; key: HTMLElement } {
	const row = document.body.createDiv({ cls: "metadata-property" });
	const key = row.createDiv({ cls: "metadata-property-key" });
	const value = row.createDiv({
		cls: "metadata-property-value",
		attr: { "data-property-type": opts.shape === "text" ? "text" : "multitext" },
	});
	let linkEl: HTMLElement;
	let sibling: HTMLElement;
	if (opts.shape === "text") {
		const wrapper = value.createDiv({ cls: "metadata-link" });
		linkEl = wrapper.createDiv({ cls: "metadata-link-inner " + opts.cls });
		sibling = wrapper.createDiv({ cls: "metadata-link-flair" });
	} else {
		const container = value.createDiv({ cls: "multi-select-container" });
		const pill = container.createDiv({ cls: "multi-select-pill" });
		linkEl = pill.createDiv({ cls: "multi-select-pill-content " + opts.cls });
		sibling = pill.createDiv({ cls: "multi-select-pill-remove-button" });
	}
	linkEl.textContent = opts.text;
	if (opts.dataHref !== null) linkEl.setAttribute("data-href", opts.dataHref);
	return { linkEl, sibling, key };
}

/** a property value in editing / plain-text state: no link classes at all */
function editingPropertyRow(): HTMLElement {
	const row = document.body.createDiv({ cls: "metadata-property" });
	const value = row.createDiv({
		cls: "metadata-property-value",
		attr: { "data-property-type": "text" },
	});
	return value.createDiv({
		cls: "metadata-input-longtext",
		attr: { contenteditable: "true" },
	});
}

describe("resolveLinkAt in the properties panel", () => {
	// the real normalizer: property values carry arbitrary text, so the
	// rejection of emails, wikilinks and prose must be the production policy.
	// The vault resolver claims "meeting.wiki": domain-shaped with a known
	// TLD, so it actually REACHES the isVaultPath gate (prose-shaped values
	// die at DOMAIN_PATTERN long before it)
	const propNormalize = (raw: string) => normalizeUrl(raw, (t) => t === "meeting.wiki");
	const at = (el: Element) =>
		resolveLinkAt(el, new MouseEvent("mouseover"), propNormalize);

	it("resolves a URL text property via data-href", () => {
		const { linkEl } = propertyRow({
			shape: "text",
			cls: "external-link",
			dataHref: "https://example.com/clip",
			text: "https://example.com/clip",
		});
		const hit = at(linkEl);
		expect(hit?.url).toBe("https://example.com/clip");
		expect(hit?.anchor).toBe(linkEl);
	});

	it("resolves a URL inside a list property pill", () => {
		const { linkEl } = propertyRow({
			shape: "pill",
			cls: "external-link",
			dataHref: "https://example.com/item",
			text: "https://example.com/item",
		});
		expect(at(linkEl)?.url).toBe("https://example.com/item");
	});

	it("1.5.3 shape: no data-href, the rendered text is the URL", () => {
		const { linkEl } = propertyRow({
			shape: "text",
			cls: "external-link",
			dataHref: null,
			text: "https://example.com/old",
		});
		expect(at(linkEl)?.url).toBe("https://example.com/old");
	});

	it("newer [title](url) shape: title in text, URL in data-href, and data-href wins", () => {
		const { linkEl } = propertyRow({
			shape: "text",
			cls: "external-link",
			dataHref: "https://example.com/titled",
			text: "My clipping",
		});
		expect(at(linkEl)?.url).toBe("https://example.com/titled");
	});

	it("never touches internal-link property values (core Page Preview territory)", () => {
		const { linkEl } = propertyRow({
			shape: "text",
			cls: "internal-link",
			dataHref: "Links",
			text: "Links",
		});
		expect(at(linkEl)).toBeNull();
	});

	it("1.5.3 email shape: external-link class with a bare address never previews", () => {
		// old Obsidian toggles external-link on for emails too, with no
		// data-href; the address must die in normalization, not render
		const { linkEl } = propertyRow({
			shape: "text",
			cls: "external-link",
			dataHref: null,
			text: "user@example.com",
		});
		expect(at(linkEl)).toBeNull();
	});

	it("editing state (no link classes) resolves nothing", () => {
		expect(at(editingPropertyRow())).toBeNull();
	});

	it("hovering the pencil flair or a pill's remove button resolves nothing", () => {
		const text = propertyRow({
			shape: "text",
			cls: "external-link",
			dataHref: "https://example.com/",
			text: "https://example.com/",
		});
		const pill = propertyRow({
			shape: "pill",
			cls: "external-link",
			dataHref: "https://example.com/",
			text: "https://example.com/",
		});
		expect(at(text.sibling)).toBeNull();
		expect(at(pill.sibling)).toBeNull();
		expect(at(text.key)).toBeNull();
	});

	it("resolves from a descendant of the link element (future-proofing)", () => {
		const { linkEl } = propertyRow({
			shape: "text",
			cls: "external-link",
			dataHref: "https://example.com/",
			text: "",
		});
		const span = linkEl.createSpan();
		span.textContent = "https://example.com/";
		expect(at(span)?.url).toBe("https://example.com/");
	});

	it("an external-link div OUTSIDE a property value resolves nothing", () => {
		const stray = document.body.createDiv({ cls: "external-link" });
		stray.setAttribute("data-href", "https://example.com/");
		expect(at(stray)).toBeNull();
	});

	// NOTE: the properties-before-editor chain ordering cannot be witnessed
	// in jsdom (findFromDOM has no mounted view, so both orders behave the
	// same here); the live-preview assertion in e2e/specs/props.e2e.ts is
	// the pin for it.

	it("permutation sweep: only external-link values with normalizable URLs resolve", () => {
		const shapes = ["text", "pill"] as const;
		const classes = ["external-link", "internal-link"] as const;
		const hrefModes = ["attribute", "text-only"] as const;
		const targets = ["link", "sibling", "key"] as const;
		const raws: Array<{ raw: string; normalized: string | null }> = [
			{ raw: "https://example.com/x", normalized: "https://example.com/x" },
			{ raw: "www.example.com", normalized: "https://www.example.com" },
			{ raw: "meeting.wiki", normalized: null }, // domain-shaped vault collision
			{ raw: "user@example.com", normalized: null },
			{ raw: "[[Links]]", normalized: null },
			{ raw: "web clipping", normalized: null },
		];
		for (const shape of shapes) {
			for (const cls of classes) {
				for (const hrefMode of hrefModes) {
					for (const target of targets) {
						for (const { raw, normalized } of raws) {
							document.body.innerHTML = "";
							const { linkEl, sibling, key } = propertyRow({
								shape,
								cls,
								dataHref: hrefMode === "attribute" ? raw : null,
								text: hrefMode === "attribute" ? "label" : raw,
							});
							const el =
								target === "link" ? linkEl : target === "sibling" ? sibling : key;
							const expected =
								cls === "external-link" && target === "link" && normalized !== null
									? normalized
									: null;
							expect(
								at(el)?.url ?? null,
								`${shape}/${cls}/${hrefMode}/${target}/${raw}`
							).toBe(expected);
						}
					}
				}
			}
		}
	});
});

describe("resolveLinkAt through canvas blockers", () => {
	it("finds the covered anchor under the pointer", () => {
		const { blocker } = canvasCard([
			{ href: "https://example.com/", rect: new DOMRect(100, 50, 80, 20) },
		]);
		const hit = resolveLinkAt(blocker, mouseAt(120, 60), normalize);
		expect(hit?.url).toBe("https://example.com/");
	});

	it("returns null when the pointer is over card text, not the link", () => {
		const { blocker } = canvasCard([
			{ href: "https://example.com/", rect: new DOMRect(100, 50, 80, 20) },
		]);
		expect(resolveLinkAt(blocker, mouseAt(300, 200), normalize)).toBeNull();
	});

	it("picks the right anchor when the card holds several", () => {
		const { blocker } = canvasCard([
			{ href: "https://first.example/", rect: new DOMRect(100, 50, 80, 20) },
			{ href: "https://second.example/", rect: new DOMRect(100, 90, 80, 20) },
		]);
		expect(resolveLinkAt(blocker, mouseAt(120, 100), normalize)?.url).toBe(
			"https://second.example/"
		);
	});

	it("ignores internal links inside cards, like reading mode does", () => {
		const { blocker } = canvasCard([
			{
				href: "Some Note",
				cls: "internal-link",
				rect: new DOMRect(100, 50, 80, 20),
			},
		]);
		expect(resolveLinkAt(blocker, mouseAt(120, 60), normalize)).toBeNull();
	});

	it("does nothing for non-blocker targets", () => {
		const plain = document.body.createDiv({ cls: "canvas-node" });
		expect(resolveLinkAt(plain, mouseAt(0, 0), normalize)).toBeNull();
	});
});
