import * as path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.resolve(dirname, "../.obsidian-cache");

/** captures the README/store screenshots by driving real Obsidian; run
 *  with `npm run shots`. Not part of any test suite. */
export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: [path.join(dirname, "screenshots/**/*.e2e.ts")],
	maxInstances: 1,

	capabilities: [
		{
			browserName: "obsidian",
			"wdio:obsidianOptions": {
				appVersion: "latest",
				installerVersion: "latest",
				plugins: [path.resolve(dirname, "..")],
				vault: path.join(dirname, "vault"),
			},
		},
	],

	services: ["obsidian"],
	reporters: ["obsidian"],
	mochaOpts: {
		ui: "bdd",
		timeout: 240 * 1000, // the media shot waits out ad chains
	},
	waitforInterval: 250,
	waitforTimeout: 10 * 1000,
	logLevel: "warn",
	cacheDir,
	injectGlobals: false,
};
