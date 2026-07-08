import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";
import { parseObsidianVersions } from "wdio-obsidian-service";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// wdio-obsidian-service downloads Obsidian versions into this directory
const cacheDir = path.resolve(dirname, "../.obsidian-cache");

// app/installer pairs. "earliest" runs the manifest's minAppVersion on the
// oldest compatible installer, which is the coverage that catches
// installer-pinned Chromium regressions (see the volume slider incident).
const versions = await parseObsidianVersions(
	env.OBSIDIAN_VERSIONS ?? "earliest/earliest latest/latest",
	{ cacheDir }
);
if (env.CI) {
	// printed so the workflow can use the resolved versions as its cache key
	console.log("obsidian-cache-key:", JSON.stringify(versions));
}

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: [path.join(dirname, "specs/**/*.e2e.ts")],
	maxInstances: Number(env.WDIO_MAX_INSTANCES || 1),

	capabilities: versions.map<WebdriverIO.Capabilities>(
		([appVersion, installerVersion]) => ({
			browserName: "obsidian",
			"wdio:obsidianOptions": {
				appVersion,
				installerVersion,
				plugins: [path.resolve(dirname, "..")],
				vault: path.join(dirname, "vault"),
			},
		})
	),

	services: ["obsidian"],
	// wraps spec-reporter to show the Obsidian version instead of Chromium's
	reporters: ["obsidian"],

	mochaOpts: {
		ui: "bdd",
		timeout: 60 * 1000,
	},
	waitforInterval: 250,
	waitforTimeout: 5 * 1000,
	logLevel: "warn",
	cacheDir,
	injectGlobals: false,
};
