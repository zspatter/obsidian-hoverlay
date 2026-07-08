/**
 * Minimal implementations of Obsidian's DOM helper prototype extensions and
 * window globals for jsdom component tests: only what the popover manager
 * and card renderer actually use. Import for side effects before
 * constructing any component.
 */

interface ElInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
}

function applyInfo(el: HTMLElement, info?: ElInfo | string): void {
	if (typeof info === "string") {
		el.className = info;
		return;
	}
	if (!info) return;
	if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
	if (info.text) el.textContent = info.text;
	if (info.attr) {
		for (const [key, value] of Object.entries(info.attr)) {
			if (value !== null && value !== undefined) el.setAttribute(key, String(value));
		}
	}
}

function createEl(this: HTMLElement, tag: string, info?: ElInfo | string): HTMLElement {
	const el = document.createElement(tag);
	applyInfo(el, info);
	this.appendChild(el);
	return el;
}

Object.assign(HTMLElement.prototype, {
	createEl,
	createDiv(this: HTMLElement, info?: ElInfo | string) {
		return createEl.call(this, "div", info);
	},
	createSpan(this: HTMLElement, info?: ElInfo | string) {
		return createEl.call(this, "span", info);
	},
	addClass(this: HTMLElement, ...classes: string[]) {
		this.classList.add(...classes);
	},
	removeClass(this: HTMLElement, ...classes: string[]) {
		this.classList.remove(...classes);
	},
	toggleClass(this: HTMLElement, classes: string | string[], value: boolean) {
		for (const cls of Array.isArray(classes) ? classes : [classes]) {
			this.classList.toggle(cls, value);
		}
	},
	hasClass(this: HTMLElement, cls: string) {
		return this.classList.contains(cls);
	},
	setText(this: HTMLElement, text: string) {
		this.textContent = text;
	},
	empty(this: HTMLElement) {
		while (this.firstChild) this.removeChild(this.firstChild);
	},
});

// cross-window-safe instanceof, used instead of the identity-based operator
Object.assign(Node.prototype, {
	instanceOf<T>(this: Node, type: new (...args: never[]) => T): boolean {
		return this instanceof type;
	},
});

// Obsidian's pop-out-aware globals; jsdom has a single window
const globals = globalThis as { activeWindow?: Window; activeDocument?: Document };
globals.activeWindow = window;
globals.activeDocument = document;

export {};
