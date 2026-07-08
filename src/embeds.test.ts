import { describe, expect, it } from "vitest";
import { resolveEmbedUrl } from "./embeds";

describe("resolveEmbedUrl", () => {
	it("transforms YouTube watch URLs in all their forms", () => {
		expect(resolveEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
			"https://www.youtube.com/embed/dQw4w9WgXcQ"
		);
		expect(resolveEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
			"https://www.youtube.com/embed/dQw4w9WgXcQ"
		);
		expect(resolveEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
			"https://www.youtube.com/embed/dQw4w9WgXcQ"
		);
		expect(resolveEmbedUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
			"https://www.youtube.com/embed/dQw4w9WgXcQ"
		);
	});

	it("preserves playlists and converts timestamps", () => {
		expect(
			resolveEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123abc")
		).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?list=PL123abc");
		expect(resolveEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe(
			"https://www.youtube.com/embed/dQw4w9WgXcQ?start=90"
		);
		expect(resolveEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=1h2m3s")).toBe(
			"https://www.youtube.com/embed/dQw4w9WgXcQ?start=3723"
		);
	});

	it("does not treat lookalike hosts as YouTube", () => {
		expect(resolveEmbedUrl("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
	});

	it("transforms Vimeo video pages only", () => {
		expect(resolveEmbedUrl("https://vimeo.com/123456789")).toBe(
			"https://player.vimeo.com/video/123456789"
		);
		expect(resolveEmbedUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
	});

	it("transforms Spotify content, including locale-prefixed paths", () => {
		expect(resolveEmbedUrl("https://open.spotify.com/track/abc123")).toBe(
			"https://open.spotify.com/embed/track/abc123"
		);
		expect(resolveEmbedUrl("https://open.spotify.com/intl-de/album/xyz789")).toBe(
			"https://open.spotify.com/embed/album/xyz789"
		);
		expect(resolveEmbedUrl("https://open.spotify.com/genre/hiphop")).toBeNull();
	});

	it("wraps SoundCloud tracks in the player, skipping reserved sections", () => {
		expect(resolveEmbedUrl("https://soundcloud.com/artist/track-name")).toBe(
			"https://w.soundcloud.com/player/?url=" +
				encodeURIComponent("https://soundcloud.com/artist/track-name")
		);
		expect(resolveEmbedUrl("https://soundcloud.com/discover")).toBeNull();
		expect(resolveEmbedUrl("https://soundcloud.com/search/results")).toBeNull();
	});

	it("returns null for everything else", () => {
		expect(resolveEmbedUrl("https://example.com/watch?v=abc")).toBeNull();
		expect(resolveEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBeNull();
		expect(resolveEmbedUrl("not a url")).toBeNull();
	});
});
