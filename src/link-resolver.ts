/**
 * Link resolution from hover targets and editor cursors. DOM/CodeMirror
 * facing but stateless; the normalization policy is injected so this module
 * stays independent of the plugin instance.
 */
import { EditorView } from "@codemirror/view";
import type { Editor } from "obsidian";
import { findLinkAtOffset } from "./links";

export type Normalizer = (raw: string) => string | null;

export interface ResolvedLink {
	url: string;
	anchor: HTMLElement;
}

/**
 * Extract an external URL from a hovered element, covering all three view
 * modes:
 *
 * - Reading mode renders real anchors; read the raw href attribute rather
 *   than anchor.href, because scheme-less links like [site](www.foo.com)
 *   resolve against the app origin ("app://obsidian.md/www.foo.com").
 *   Anchors marked internal-link belong to core Page Preview and are never
 *   touched.
 * - Source mode and live preview are CodeMirror: posAtCoords maps the mouse
 *   position to a document offset and the containing line is scanned for a
 *   link covering it. This handles live preview's folded [text](url) links
 *   (the URL never exists in the DOM) and plain untokenized text alike.
 */
/**
 * Nothing in this module may compare constructors (instanceof, or Obsidian's
 * instanceOf): pop-out windows hold a mix of nodes adopted from the main
 * document and nodes built by the pop-out's own realm, so identity checks
 * pass or fail per node. Selectors like closest() already guarantee the
 * element kind; nodeType covers the rest.
 */
export function resolveLinkAt(
	el: Element,
	evt: MouseEvent,
	normalize: Normalizer
): ResolvedLink | null {
	const anchor = el.closest("a");
	if (anchor) {
		if (anchor.classList.contains("internal-link")) return null;
		const url = normalize(anchor.getAttribute("href") ?? "");
		return url ? { url, anchor } : null;
	}
	return resolveInEditor(el, evt, normalize) ?? resolveThroughCanvasBlocker(el, evt, normalize);
}

/**
 * Unfocused canvas cards cover their rendered content with a blocker div
 * that receives every mouse event, so links inside never become hover
 * targets themselves. When the pointer sits on a blocker, hit-test the
 * covered card for an anchor under the pointer; cards left in editing
 * state keep a CodeMirror instance behind the blocker instead.
 */
function resolveThroughCanvasBlocker(
	el: Element,
	evt: MouseEvent,
	normalize: Normalizer
): ResolvedLink | null {
	if (!el.classList.contains("canvas-node-content-blocker")) return null;
	const node = el.closest(".canvas-node");
	if (!node) return null;

	for (const anchor of Array.from(node.querySelectorAll("a"))) {
		if (anchor.classList.contains("internal-link")) continue;
		// getClientRects, not the bounding box: a wrapped inline link's
		// bounding box covers text that isn't part of the link
		const hit = Array.from(anchor.getClientRects()).some(
			(rect) =>
				evt.clientX >= rect.left &&
				evt.clientX <= rect.right &&
				evt.clientY >= rect.top &&
				evt.clientY <= rect.bottom
		);
		if (!hit) continue;
		const url = normalize(anchor.getAttribute("href") ?? "");
		return url ? { url, anchor } : null;
	}

	const editorEl = node.querySelector(".cm-editor");
	return editorEl ? resolveInEditor(editorEl, evt, normalize) : null;
}

function resolveInEditor(
	el: Element,
	evt: MouseEvent,
	normalize: Normalizer
): ResolvedLink | null {
	const editorEl = el.closest(".cm-editor") as HTMLElement | null;
	if (!editorEl) return null;

	const view = EditorView.findFromDOM(editorEl);
	if (!view) return null;

	const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY });
	if (pos === null) return null;

	const line = view.state.doc.lineAt(pos);
	const rawLink = findLinkAtOffset(line.text, pos - line.from);
	if (!rawLink) return null;

	const url = normalize(rawLink);
	if (!url) return null;

	const token = el.closest(".cm-url, .cm-link, .cm-underline") as HTMLElement | null;
	return { url, anchor: token ?? (el as HTMLElement) };
}

/** the link under the editor cursor plus its screen rect, for the
 *  preview-link-under-cursor command */
export function resolveEditorCursorLink(
	editor: Editor,
	normalize: Normalizer
): { url: string; rect: DOMRect } | null {
	const cursor = editor.getCursor();
	const raw = findLinkAtOffset(editor.getLine(cursor.line), cursor.ch);
	if (!raw) return null;

	const url = normalize(raw);
	if (!url) return null;

	// anchor the popover at the cursor's screen position
	let rect = new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0);
	const view = (editor as unknown as { cm?: EditorView }).cm;
	if (view) {
		const pos = Math.min(
			view.state.doc.line(cursor.line + 1).from + cursor.ch,
			view.state.doc.length
		);
		const coords = view.coordsAtPos(pos);
		if (coords) {
			rect = new DOMRect(
				coords.left,
				coords.top,
				coords.right - coords.left,
				coords.bottom - coords.top
			);
		}
	}
	return { url, rect };
}
