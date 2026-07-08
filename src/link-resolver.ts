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
export function resolveLinkAt(
	el: Element,
	evt: MouseEvent,
	normalize: Normalizer
): ResolvedLink | null {
	const anchor = el.closest("a");
	if (anchor instanceof HTMLAnchorElement) {
		if (anchor.classList.contains("internal-link")) return null;
		const url = normalize(anchor.getAttribute("href") ?? "");
		return url ? { url, anchor } : null;
	}
	return resolveInEditor(el, evt, normalize);
}

function resolveInEditor(
	el: Element,
	evt: MouseEvent,
	normalize: Normalizer
): ResolvedLink | null {
	const editorEl = el.closest(".cm-editor");
	if (!(editorEl instanceof HTMLElement)) return null;

	const view = EditorView.findFromDOM(editorEl);
	if (!view) return null;

	const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY });
	if (pos === null) return null;

	const line = view.state.doc.lineAt(pos);
	const rawLink = findLinkAtOffset(line.text, pos - line.from);
	if (!rawLink) return null;

	const url = normalize(rawLink);
	if (!url) return null;

	const token = el.closest(".cm-url, .cm-link, .cm-underline");
	const anchorEl =
		token instanceof HTMLElement ? token : el instanceof HTMLElement ? el : editorEl;
	return { url, anchor: anchorEl };
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
