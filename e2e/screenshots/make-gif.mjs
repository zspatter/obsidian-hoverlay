/**
 * Assembles the hover-action frames captured by capture.e2e.ts into the
 * README gif. Pure Node (pngjs + gifenc); no ffmpeg dependency.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import pngjs from "pngjs";
import gifenc from "gifenc";

// both packages are CommonJS; named imports don't survive the ESM boundary
const { PNG } = pngjs;
const { GIFEncoder, quantize, applyPalette } = gifenc;

const FRAMES = "e2e/screenshots/frames";
const OUT = "docs/screenshots/hover.gif";
const TARGET_WIDTH = 800;
const FRAME_DELAY_MS = 300;
const END_HOLD_MS = 1800; // linger on the finished preview before looping

if (!existsSync(FRAMES)) {
	console.log("no frames captured; skipping gif assembly");
	process.exit(0);
}

const files = readdirSync(FRAMES)
	.filter((name) => name.endsWith(".png"))
	.sort();
if (files.length === 0) {
	console.log("no frames captured; skipping gif assembly");
	process.exit(0);
}

/** nearest-neighbor downscale; screenshots are crisp enough for it */
function scale(png, targetWidth) {
	const factor = targetWidth / png.width;
	const width = targetWidth;
	const height = Math.round(png.height * factor);
	const out = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		const sourceY = Math.min(png.height - 1, Math.round(y / factor));
		for (let x = 0; x < width; x++) {
			const sourceX = Math.min(png.width - 1, Math.round(x / factor));
			const from = (sourceY * png.width + sourceX) * 4;
			const to = (y * width + x) * 4;
			out[to] = png.data[from];
			out[to + 1] = png.data[from + 1];
			out[to + 2] = png.data[from + 2];
			out[to + 3] = 255;
		}
	}
	return { width, height, data: out };
}

const gif = GIFEncoder();
for (const [index, file] of files.entries()) {
	const png = PNG.sync.read(readFileSync(path.join(FRAMES, file)));
	const frame = scale(png, TARGET_WIDTH);
	const palette = quantize(frame.data, 256);
	const indexed = applyPalette(frame.data, palette);
	const delay = index === files.length - 1 ? END_HOLD_MS : FRAME_DELAY_MS;
	gif.writeFrame(indexed, frame.width, frame.height, { palette, delay });
}
gif.finish();
writeFileSync(OUT, gif.bytes());
console.log(`wrote ${OUT} (${files.length} frames)`);
