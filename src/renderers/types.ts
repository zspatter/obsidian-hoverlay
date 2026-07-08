export interface RendererHandle {
	dispose(): void;
	/** present only for renderers that support live zoom (the webview) */
	setZoom?(zoom: number): void;
	/** present only for renderers with a navigation history (the webview) */
	navigation?: {
		back(): void;
		forward(): void;
		canGoBack(): boolean;
		canGoForward(): boolean;
	};
}
