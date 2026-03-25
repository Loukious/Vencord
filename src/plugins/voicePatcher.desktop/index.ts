/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";

import Settings from "./components/Settings";

export const Native = VencordNative.pluginHelpers.VoicePatcher as PluginNative<typeof import("./native")>;

export const settings = definePluginSettings({
    disabledPatches: { type: OptionType.STRING, description: "Hidden Disabled Patches", default: "[]", hidden: true },
    customPatches: { type: OptionType.STRING, description: "Hidden Custom Patches", default: "[]", hidden: true },
    ui: {
        type: OptionType.COMPONENT,
        component: Settings,
    }
});

export function applyAndLogPatches(disabledPatches: string, customPatches: string) {
    return Native.applyPatches(disabledPatches, customPatches).then(result => {
        if (result.error) {
            console.error("[VoicePatcher] Error:", result.error);
            return result;
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

        for (const p of result.patches || []) {
            const icon = p.status === "ok" ? "✓"
                : p.status === "already_patched" ? "~"
                    : /(not[_-]?resolved|not[_-]?found|missing|unresolved|invalid)/i.test(p.status) ? "?"
                        : "✗";
            console.log(
                `[VoicePatcher] ${icon} ${p.name}: ${p.status}` +
                `${p.tier ? ` [${p.tier}]` : ""}` +
                `${p.rva ? ` @ RVA ${p.rva}` : ""}`
            );
        }

        console.log(`[VoicePatcher] Done — ok:${result.ok} failed:${result.failed} skipped:${result.skipped}`);
        return result;
    });
}

export default definePlugin({
    name: "VoicePatcher",
    description: "Patches discord_voice.node in memory for stereo/bitrate unlocks",
    authors: [Devs.Loukious],
    settings,
    start() {
        try {
            const nativeModules = globalThis.DiscordNative?.nativeModules;
            if (!nativeModules?.requireModule) {
                throw new Error("DiscordNative.nativeModules is unavailable");
            }

            nativeModules.requireModule("discord_voice");
            applyAndLogPatches(
                settings.store.disabledPatches || "[]",
                settings.store.customPatches || "[]"
            ).catch(e => {
                console.error("[VoicePatcher] Failed:", e);
            });
        } catch (e) {
            console.error("[VoicePatcher] Failed:", e);
        }
    }
});
