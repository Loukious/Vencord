/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.VoicePatcher as PluginNative<typeof import("./native")>;

export default definePlugin({
    name: "VoicePatcher",
    description: "Patches discord_voice.node in memory for stereo/bitrate unlocks",
    authors: [Devs.Loukious],

    start() {
        try {
            const nativeModules = globalThis.DiscordNative?.nativeModules;
            if (!nativeModules?.requireModule) {
                throw new Error("DiscordNative.nativeModules is unavailable");
            }

            nativeModules.requireModule("discord_voice");
            Native.applyPatches().then(result => {
                if (result.error) {
                    console.error("[VoicePatcher] Error:", result.error);
                    return;
                }

                if (result.patches_in_ini === 0 && result.iniSectionCount > 0) {
                    console.warn(
                        `[VoicePatcher] INI loaded from ${result.iniPath}, but the native patcher accepted 0 ` +
                        `patch definitions out of ${result.iniSectionCount} section(s).`
                    );
                }

                console.log(`[VoicePatcher] Module: ${result.module_base} (${result.module_size})`);
                console.log(`[VoicePatcher] Assets: ${result.assetSource}`);
                console.log(`[VoicePatcher] Loaded ${result.patches_in_ini} patch definitions from INI`);

                for (const p of result.patches) {
                    const icon = p.status === "ok" ? "✓"
                        : p.status === "already_patched" ? "~"
                            : /(not[_-]?found|missing|unresolved|invalid)/i.test(p.status) ? "?"
                                : "✗";
                    console.log(`[VoicePatcher] ${icon} ${p.name}: ${p.status}${p.rva ? ` @ RVA ${p.rva}` : ""}`);
                }

                console.log(`[VoicePatcher] Done — ok:${result.ok} failed:${result.failed} skipped:${result.skipped}`);
            }).catch(e => {
                console.error("[VoicePatcher] Failed:", e);
            });
        } catch (e) {
            console.error("[VoicePatcher] Failed:", e);
        }
    }
});
