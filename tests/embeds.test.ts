import { describe, expect, it } from "vitest";
import { resolveEmbed, resolveEmbedUrl } from "../src/embeds";

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

describe("resolveEmbed sizing hints", () => {
	it("video players carry the 16:9 aspect ratio", () => {
		expect(resolveEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
			url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
			aspectRatio: 16 / 9,
		});
		expect(resolveEmbed("https://youtu.be/dQw4w9WgXcQ")?.aspectRatio).toBe(16 / 9);
		expect(resolveEmbed("https://vimeo.com/123456789")?.aspectRatio).toBe(16 / 9);
	});

	it("Spotify cards carry their fixed heights", () => {
		for (const type of ["track", "album", "playlist", "artist"]) {
			expect(resolveEmbed(`https://open.spotify.com/${type}/abc123`)).toEqual({
				url: `https://open.spotify.com/embed/${type}/abc123`,
				height: 352,
			});
		}
		for (const type of ["episode", "show"]) {
			expect(resolveEmbed(`https://open.spotify.com/${type}/abc123`)).toEqual({
				url: `https://open.spotify.com/embed/${type}/abc123`,
				height: 232,
			});
		}
	});

	it("SoundCloud's fluid player gets no hint", () => {
		const info = resolveEmbed("https://soundcloud.com/artist/track-name");
		expect(info?.url).toContain("w.soundcloud.com/player");
		expect(info?.height).toBeUndefined();
		expect(info?.aspectRatio).toBeUndefined();
	});
});
