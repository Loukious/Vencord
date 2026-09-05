/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";
import { DATA_DIR } from "@main/utils/constants";
import { downloadToFile, fetchJson } from "@main/utils/http";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import { join, resolve } from "path";

// The iroh wasm endpoint talks to the outside world exclusively over
// WebTransport/HTTPS to iroh's relay and discovery infrastructure — none of
// which Discord's CSP would allow. Registering them here (before initCsp()
// installs the header rewriter, since plugin natives are imported at main
// process startup) routes them through Vencord's CSP patch.
//
// CSP wildcards match exactly ONE host label, so the deep relay hostnames
// (aps1-1.relay.n0.iroh.link) need the full *.relay.n0.iroh.link pattern —
// *.iroh.link would never match them. The list below is exhaustive for this
// wasm build: every hostname string embedded in the binary is covered
CspPolicies["*.relay.n0.iroh.link"] = ConnectSrc; // N0 relays (use1-1/euw1-1/euc1-1/aps1-1/usw1-1)
CspPolicies["*.relay.n0.iroh.link."] = ConnectSrc; // iroh presets use the FQDN trailing-dot form, and CSP host matching does not always normalize it away
CspPolicies["wss://*.relay.n0.iroh.link"] = ConnectSrc; // the wasm relay connection is a WebSocket — scheme-less entries only match http(s), so wss needs to be spelled out
CspPolicies["wss://*.relay.n0.iroh.link."] = ConnectSrc;
CspPolicies["*.staging-relay.n0.iroh.link"] = ConnectSrc; // staging relays (harmless, but the names are in the binary)
CspPolicies["*.staging-relay.n0.iroh.link."] = ConnectSrc;
CspPolicies["wss://*.staging-relay.n0.iroh.link"] = ConnectSrc;
CspPolicies["wss://*.staging-relay.n0.iroh.link."] = ConnectSrc;
CspPolicies["dns.iroh.link"] = ConnectSrc; // N0 DNS discovery
CspPolicies["dns.iroh.link."] = ConnectSrc;
CspPolicies["staging-dns.iroh.link"] = ConnectSrc;
CspPolicies["staging-dns.iroh.link."] = ConnectSrc;
CspPolicies["n0.computer"] = ConnectSrc; // pkarr publishing posts to the bare host
CspPolicies["n0.computer."] = ConnectSrc;
CspPolicies["*.n0.computer"] = ConnectSrc; // pkarr discovery
CspPolicies["*.iroh.computer"] = ConnectSrc; // legacy DNS discovery naming
CspPolicies["*.iroh.network"] = ConnectSrc; // legacy relay naming

// dashbeam does not publish their built wasm to GitHub releases (the desktop
// app stubs it out; only their deployed site has one), so the bridge build is
// published to this repo instead and auto-downloaded from there
const WASM_RELEASE_API = "https://api.github.com/repos/Loukious/VencordDashBeamWasm/releases/latest";
const WASM_ASSET_NAME = "wasm_bridge_bg.wasm";
const WASM_CACHE_DIR = join(DATA_DIR, "plugins", "DashBeam");
const WASM_CACHE_META_PATH = join(WASM_CACHE_DIR, "release.json");

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
    wasmAssetId: number;
};

type ResolvedWasm = {
    path: string;
    source: string;
};

let downloadPromise: Promise<ResolvedWasm | null> | null = null;

function getGitHubHeaders() {
    return {
        Accept: "application/vnd.github+json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": VENCORD_USER_AGENT,
    };
}

function loadCachedReleaseMeta(): CachedReleaseMeta | null {
    if (!existsSync(WASM_CACHE_META_PATH)) return null;
    try {
        return JSON.parse(readFileSync(WASM_CACHE_META_PATH, "utf8")) as CachedReleaseMeta;
    } catch {
        return null;
    }
}

function resolveCachedWasm(): ResolvedWasm | null {
    const meta = loadCachedReleaseMeta();
    if (!meta) return null;

    // Release-asset-versioned filename, so a stale file can never be mistaken
    // for a fresh download
    const cachedPath = join(WASM_CACHE_DIR, `wasm-${meta.wasmAssetId}.wasm`);
    if (existsSync(cachedPath)) {
        return { path: cachedPath, source: `cached wasm release ${meta.tagName}` };
    }
    return null;
}

async function downloadWasmOnce(): Promise<ResolvedWasm | null> {
    mkdirSync(WASM_CACHE_DIR, { recursive: true });
    const cached = resolveCachedWasm();

    try {
        const release = await fetchJson<GitHubRelease>(`${WASM_RELEASE_API}?t=${Date.now()}`, {
            headers: getGitHubHeaders(),
        });

        const asset = (release.assets ?? []).find(a => a.name.toLowerCase() === WASM_ASSET_NAME);
        if (!asset) {
            throw new Error(`Latest VencordDashBeamWasm release has no ${WASM_ASSET_NAME} asset`);
        }

        const targetPath = join(WASM_CACHE_DIR, `wasm-${asset.id}.wasm`);
        if (!existsSync(targetPath)) {
            const tempPath = `${targetPath}.download`;
            try {
                await downloadToFile(asset.browser_download_url, tempPath, {
                    headers: { "User-Agent": VENCORD_USER_AGENT },
                });
                if (existsSync(targetPath)) unlinkSync(targetPath);
                renameSync(tempPath, targetPath);
            } finally {
                if (existsSync(tempPath)) unlinkSync(tempPath);
            }
        }

        writeFileSync(WASM_CACHE_META_PATH, JSON.stringify({
            tagName: release.tag_name,
            wasmAssetId: asset.id,
        }, null, 2));

        return { path: targetPath, source: `wasm release ${release.tag_name}` };
    } catch (error) {
        console.warn("[DashBeam] Failed to fetch wasm release; falling back to cache or source tree:", error);
        return cached;
    }
}

async function resolveWasm(): Promise<ResolvedWasm> {
    // Deduplicate concurrent callers only — later calls should still be able
    // to discover a newly published release
    downloadPromise ??= downloadWasmOnce();
    const downloaded = await downloadPromise.finally(() => downloadPromise = null);
    if (downloaded) return downloaded;

    // Local development: the wasm built from the dashbeam source tree lives
    // next to the plugin
    const repoRoot = resolve(__dirname, "..");
    const candidates = [
        join(repoRoot, "src", "plugins", "dashbeam.desktop", "wasm", "wasm_bridge_bg.wasm"),
        join(repoRoot, "src", "userplugins", "dashbeam.desktop", "wasm", "wasm_bridge_bg.wasm"),
    ];

    for (const path of candidates) {
        if (existsSync(path)) {
            return { path, source: "source tree wasm build" };
        }
    }

    throw new Error("Could not locate or download the DashBeam wasm bridge");
}

// The renderer passes the bytes straight into WebAssembly.instantiate — no
// fetch involved, so loading the wasm never touches the page CSP
export async function getWasmBytesNative() {
    const { path, source } = await resolveWasm();
    console.log(`[DashBeam] Loading wasm bridge from ${source}`);
    const bytes = new Uint8Array(await readFile(path));
    return { bytes, source };
}
