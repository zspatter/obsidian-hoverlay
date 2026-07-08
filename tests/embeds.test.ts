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

	it("transforms Dailymotion video pages and dai.ly short links", () => {
		expect(resolveEmbedUrl("https://www.dailymotion.com/video/x8k4mz4")).toBe(
			"https://www.dailymotion.com/embed/video/x8k4mz4"
		);
		expect(resolveEmbedUrl("https://dai.ly/x8k4mz4")).toBe(
			"https://www.dailymotion.com/embed/video/x8k4mz4"
		);
		expect(resolveEmbedUrl("https://www.dailymotion.com/browse")).toBeNull();
	});

	it("transforms Streamable codes, skipping site pages", () => {
		expect(resolveEmbedUrl("https://streamable.com/abc123")).toBe(
			"https://streamable.com/e/abc123"
		);
		expect(resolveEmbedUrl("https://streamable.com/login")).toBeNull();
		expect(resolveEmbedUrl("https://streamable.com/a/b")).toBeNull();
	});

	it("transforms Loom share links only", () => {
		expect(
			resolveEmbedUrl("https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184")
		).toBe("https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184");
		expect(resolveEmbedUrl("https://www.loom.com/looms/videos")).toBeNull();
	});

	it("transforms Apple Music and Podcasts pages to their embed twins", () => {
		expect(resolveEmbedUrl("https://music.apple.com/us/album/thriller/269572838")).toBe(
			"https://embed.music.apple.com/us/album/thriller/269572838"
		);
		expect(
			resolveEmbedUrl("https://music.apple.com/us/album/thriller/269572838?i=269573364")
		).toBe("https://embed.music.apple.com/us/album/thriller/269572838?i=269573364");
		expect(
			resolveEmbedUrl("https://podcasts.apple.com/us/podcast/some-show/id123456789")
		).toBe("https://embed.podcasts.apple.com/us/podcast/some-show/id123456789");
		expect(resolveEmbedUrl("https://music.apple.com/us/artist/queen/3296287")).toBeNull();
	});

	it("transforms Deezer content, including locale-prefixed paths", () => {
		expect(resolveEmbedUrl("https://www.deezer.com/track/3135556")).toBe(
			"https://widget.deezer.com/widget/auto/track/3135556"
		);
		expect(resolveEmbedUrl("https://www.deezer.com/en/album/302127")).toBe(
			"https://widget.deezer.com/widget/auto/album/302127"
		);
		expect(resolveEmbedUrl("https://www.deezer.com/en/channels/pop")).toBeNull();
	});

	it("returns null for everything else", () => {
		expect(resolveEmbedUrl("https://example.com/watch?v=abc")).toBeNull();
		expect(resolveEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBeNull();
		expect(resolveEmbedUrl("https://notdailymotion.com/video/x8k4mz4")).toBeNull();
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
		expect(resolveEmbed("https://dai.ly/x8k4mz4")?.aspectRatio).toBe(16 / 9);
		expect(resolveEmbed("https://streamable.com/abc123")?.aspectRatio).toBe(16 / 9);
		expect(
			resolveEmbed("https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184")
				?.aspectRatio
		).toBe(16 / 9);
	});

	it("Apple cards are 450 for collections and 175 for a pinned single", () => {
		expect(
			resolveEmbed("https://music.apple.com/us/album/thriller/269572838")?.height
		).toBe(450);
		expect(
			resolveEmbed("https://music.apple.com/us/album/thriller/269572838?i=269573364")
				?.height
		).toBe(175);
		expect(
			resolveEmbed("https://music.apple.com/us/song/beat-it/269573369")?.height
		).toBe(175);
		expect(
			resolveEmbed("https://podcasts.apple.com/us/podcast/some-show/id123456789")?.height
		).toBe(450);
		expect(
			resolveEmbed(
				"https://podcasts.apple.com/us/podcast/some-show/id123456789?i=1000598765432"
			)?.height
		).toBe(175);
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

	it("fluid players (SoundCloud, Deezer) get no hint", () => {
		const soundcloud = resolveEmbed("https://soundcloud.com/artist/track-name");
		expect(soundcloud?.url).toContain("w.soundcloud.com/player");
		expect(soundcloud?.height).toBeUndefined();
		expect(soundcloud?.aspectRatio).toBeUndefined();
		const deezer = resolveEmbed("https://www.deezer.com/track/3135556");
		expect(deezer?.height).toBeUndefined();
		expect(deezer?.aspectRatio).toBeUndefined();
	});
});
