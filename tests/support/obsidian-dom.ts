/**
 * Minimal implementations of Obsidian's DOM helper prototype extensions for
 * jsdom component tests: only what the popover manager and card renderer
 * actually use. Import for side effects before constructing any component.
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

/* eslint-disable @typescript-eslint/no-explicit-any */
const proto = HTMLElement.prototype as any;

proto.createEl = function (tag: string, info?: ElInfo | string) {
	const el = document.createElement(tag);
	applyInfo(el, info);
	this.appendChild(el);
	return el;
};
proto.createDiv = function (info?: ElInfo | string) {
	return this.createEl("div", info);
};
proto.createSpan = function (info?: ElInfo | string) {
	return this.createEl("span", info);
};
proto.addClass = function (...classes: string[]) {
	this.classList.add(...classes);
};
proto.removeClass = function (...classes: string[]) {
	this.classList.remove(...classes);
};
proto.toggleClass = function (classes: string | string[], value: boolean) {
	for (const cls of Array.isArray(classes) ? classes : [classes]) {
		this.classList.toggle(cls, value);
	}
};
proto.hasClass = function (cls: string) {
	return this.classList.contains(cls);
};
proto.setText = function (text: string) {
	this.textContent = text;
};
proto.empty = function () {
	while (this.firstChild) this.removeChild(this.firstChild);
};

export {};
