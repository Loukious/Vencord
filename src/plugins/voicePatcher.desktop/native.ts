/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { downloadToFile, fetchJson } from "@main/utils/http";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const PRELOAD_WORLD_ID = 999;
const PATCHER_RELEASE_API = "https://api.github.com/repos/Loukious/DiscordVoicePatcher/releases/latest";
const PATCHER_CACHE_DIR = join(DATA_DIR, "plugins", "VoicePatcher");
const PATCHER_CACHE_NODE_PATH = join(PATCHER_CACHE_DIR, "patcher.node");
const PATCHER_CACHE_INI_PATH = join(PATCHER_CACHE_DIR, "patcher.ini");
const PATCHER_CACHE_META_PATH = join(PATCHER_CACHE_DIR, "release.json");

type ResolvedAssets = {
    patcherPath: string;
    iniPath: string;
    source: string;
};

type GitHubReleaseAsset = {
    id: number;
    name: string;
    browser_download_url: string;
};

type GitHubRelease = {
    tag_name: string;
    assets: GitHubReleaseAsset[];
};

type CachedReleaseMeta = {
    tagName: string;
    patcherAssetId: number;
    iniAssetId: number;
};

let downloadedAssetsPromise: Promise<ResolvedAssets | null> | null = null;

function getGitHubHeaders() {
    return {
        Accept: "application/vnd.github+json",
        "User-Agent": VENCORD_USER_AGENT,
    };
}

function loadCachedReleaseMeta(): CachedReleaseMeta | null {
    if (!existsSync(PATCHER_CACHE_META_PATH)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(PATCHER_CACHE_META_PATH, "utf8")) as CachedReleaseMeta;
    } catch {
        return null;
    }
}

function writeCachedReleaseMeta(meta: CachedReleaseMeta) {
    writeFileSync(PATCHER_CACHE_META_PATH, JSON.stringify(meta, null, 2));
}

function pickReleaseAsset(assets: GitHubReleaseAsset[], fileName: string) {
    return assets.find(asset => asset.name.toLowerCase() === fileName.toLowerCase()) ?? null;
}

async function downloadAssetToPath(url: string, targetPath: string) {
    const tempPath = `${targetPath}.download`;

    try {
        await downloadToFile(url, tempPath, {
            headers: getGitHubHeaders(),
        });

        if (existsSync(targetPath)) {
            unlinkSync(targetPath);
        }

        renameSync(tempPath, targetPath);
    } finally {
        if (existsSync(tempPath)) {
            unlinkSync(tempPath);
        }
    }
}

async function resolveDownloadedAssets(): Promise<ResolvedAssets | null> {
    downloadedAssetsPromise ??= (async () => {
        mkdirSync(PATCHER_CACHE_DIR, { recursive: true });

        const cachedAssetsAvailable = existsSync(PATCHER_CACHE_NODE_PATH) && existsSync(PATCHER_CACHE_INI_PATH);

        try {
            const release = await fetchJson<GitHubRelease>(PATCHER_RELEASE_API, {
                headers: getGitHubHeaders(),
            });

            const patcherAsset = pickReleaseAsset(release.assets ?? [], "patcher.node");
            const iniAsset = pickReleaseAsset(release.assets ?? [], "patcher.ini");

            if (!patcherAsset || !iniAsset) {
                throw new Error("Latest DiscordVoicePatcher release does not contain both patcher.node and patcher.ini assets");
            }

            const cachedMeta = loadCachedReleaseMeta();
            const shouldRefreshAssets =
                !cachedAssetsAvailable
                || cachedMeta?.tagName !== release.tag_name
                || cachedMeta?.patcherAssetId !== patcherAsset.id
                || cachedMeta?.iniAssetId !== iniAsset.id;

            if (shouldRefreshAssets) {
                await downloadAssetToPath(patcherAsset.browser_download_url, PATCHER_CACHE_NODE_PATH);
                await downloadAssetToPath(iniAsset.browser_download_url, PATCHER_CACHE_INI_PATH);

                writeCachedReleaseMeta({
                    tagName: release.tag_name,
                    patcherAssetId: patcherAsset.id,
                    iniAssetId: iniAsset.id,
                });
            }

            return {
                patcherPath: PATCHER_CACHE_NODE_PATH,
                iniPath: PATCHER_CACHE_INI_PATH,
                source: `DiscordVoicePatcher release ${release.tag_name}`,
            };
        } catch {
            if (!cachedAssetsAvailable) {
                return null;
            }

            const cachedMeta = loadCachedReleaseMeta();

            return {
                patcherPath: PATCHER_CACHE_NODE_PATH,
                iniPath: PATCHER_CACHE_INI_PATH,
                source: cachedMeta?.tagName
                    ? `cached DiscordVoicePatcher release ${cachedMeta.tagName}`
                    : "cached DiscordVoicePatcher assets",
            };
        }
    })();

    const resolvedAssets = await downloadedAssetsPromise;
    if (!resolvedAssets) {
        downloadedAssetsPromise = null;
    }

    return resolvedAssets;
}

function resolveLocalPluginAssets(): ResolvedAssets | null {
    const repoRoot = resolve(__dirname, "..");
    const candidates = [
        join(repoRoot, "src", "plugins", "voicePatcher.desktop"),
        join(repoRoot, "src", "userplugins", "voicePatcher.desktop"),
    ];

    for (const pluginDir of candidates) {
        if (existsSync(join(pluginDir, "patcher.node")) && existsSync(join(pluginDir, "patcher.ini"))) {
            return {
                patcherPath: join(pluginDir, "patcher.node"),
                iniPath: join(pluginDir, "patcher.ini"),
                source: "source tree VoicePatcher assets",
            };
        }
    }

    return null;
}

async function resolvePluginAssets(): Promise<ResolvedAssets> {
    const downloadedAssets = await resolveDownloadedAssets();
    if (downloadedAssets) {
        return downloadedAssets;
    }

    const localAssets = resolveLocalPluginAssets();
    if (localAssets) {
        return localAssets;
    }

    throw new Error("Could not locate or download VoicePatcher assets");
}

function inspectVoicePatcherIni(iniPath: string) {
    const ini = readFileSync(iniPath, "utf8");
    const sectionNames = [] as string[];

    for (const rawBlock of ini.split(/\r?\n(?=\[)/)) {
        const nameMatch = rawBlock.match(/^\[(.+?)\]/m);
        if (!nameMatch) continue;

        sectionNames.push(nameMatch[1]);
    }

    return {
        iniPath,
        iniSectionCount: sectionNames.length,
        iniSectionNames: sectionNames,
    };
}

export async function getOriginalIniPatches(event: IpcMainInvokeEvent) {
    const { iniPath } = await resolvePluginAssets();
    const ini = readFileSync(iniPath, "utf8");
    const patches: { name: string; content: string; }[] = [];
    for (const rawBlock of ini.split(/\r?\n(?=\[)/)) {
        if (!rawBlock.trim()) continue;
        const nameMatch = rawBlock.match(/^\[(.+?)\]/m);
        if (nameMatch) {
            patches.push({ name: nameMatch[1], content: rawBlock.trim() });
        }
    }
    return patches;
}

export async function applyPatches(event: IpcMainInvokeEvent, disabledPatchesInfo: string, customPatchesInfo: string) {
    const { patcherPath, iniPath, source } = await resolvePluginAssets();

    const disabledPatches = disabledPatchesInfo ? JSON.parse(disabledPatchesInfo) : [];
    const customPatches = customPatchesInfo ? JSON.parse(customPatchesInfo) : [];

    const originalIni = readFileSync(iniPath, "utf8");
    let customIni = "";

    for (const rawBlock of originalIni.split(/\r?\n(?=\[)/)) {
        if (!rawBlock.trim()) continue;
        const nameMatch = rawBlock.match(/^\[(.+?)\]/m);
        if (!nameMatch) {
            customIni += rawBlock + "\n\n";
            continue;
        }
        if (!disabledPatches.includes(nameMatch[1])) {
            customIni += rawBlock + "\n\n";
        }
    }

    for (const cp of customPatches) {
        if (cp.enabled) {
            customIni += "\n" + cp.content + "\n";
        }
    }

    const tempIniPath = join(require("os").tmpdir(), "custom_voice_patcher.ini");
    writeFileSync(tempIniPath, customIni);

    const result = await event.sender.executeJavaScriptInIsolatedWorld(PRELOAD_WORLD_ID, [{
        code: `(() => {
            try {
                const requireFn =
                    typeof globalThis.require === "function"
                        ? globalThis.require
                        : typeof globalThis.module?.require === "function"
                            ? globalThis.module.require.bind(globalThis.module)
                            : (() => {
                                const moduleBuiltin = globalThis.process?.getBuiltinModule?.("module")
                                    ?? globalThis.process?.getBuiltinModule?.("node:module");

                                if (!moduleBuiltin?.createRequire) {
                                    throw new Error("No require function available in isolated world");
                                }

                                return moduleBuiltin.createRequire(${JSON.stringify(patcherPath)});
                            })();

                const patcher = requireFn(${JSON.stringify(patcherPath)});
                return patcher.applyPatches(${JSON.stringify(tempIniPath)});
            } catch (error) {
                return {
                    error: error instanceof Error
                        ? \`\${error.name}: \${error.message}\`
                        : String(error)
                };
            }
        })();`
    }]);

    if (result == null) {
        throw new Error("VoicePatcher isolated-world execution returned no result");
    }

    const inspectData = inspectVoicePatcherIni(tempIniPath);
    try { unlinkSync(tempIniPath); } catch {}

    return {
        ...inspectData,
        assetSource: source,
        ...result,
    };
}
