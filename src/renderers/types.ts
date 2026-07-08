export interface RendererHandle {
	dispose(): void;
	/** present only for renderers that support live zoom (the webview) */
	setZoom?(zoom: number): void;
	/** present only for renderers that can play audio (the webview) */
	setMuted?(muted: boolean): void;
	/** present only for renderers that can play audio (the webview); 0..1 */
	setVolume?(volume: number): void;
	/** present only for renderers with a navigation history (the webview) */
	navigation?: {
		back(): void;
		forward(): void;
		canGoBack(): boolean;
		canGoForward(): boolean;
	};
}
