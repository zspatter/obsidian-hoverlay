// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { resolveLinkAt } from "../src/link-resolver";

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
