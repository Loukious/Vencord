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

function patchStatusIcon(status: string, reverting = false) {
    if (status === "ok") return "✓";
    if (reverting && status === "already_reverted") return "~";
    if (!reverting && status === "already_patched") return "~";
    if (/(not[_-]?resolved|not[_-]?found|missing|unresolved|invalid|stale)/i.test(status)) return "?";
    return "✗";
}

function logPatchRows(result: any, reverting = false) {
    for (const p of result?.patches || []) {
        console.log(
            `[VoicePatcher] ${patchStatusIcon(p.status, reverting)} ${p.name}: ${p.status}` +
            `${p.tier ? ` [${p.tier}]` : ""}` +
            `${p.rva ? ` @ RVA ${p.rva}` : ""}`
        );
    }
}

function logRevertSummary(result: any, label: string) {
    if (!result) return;

    console.log(`[VoicePatcher] ${label}`);
    logPatchRows(result, true);
    console.log(
        `[VoicePatcher] Revert done — ok:${result.ok ?? 0} failed:${result.failed ?? 0} ` +
        `skipped:${result.skipped ?? 0} tracked:${result.tracked_after ?? 0}`
    );
}

export function applyAndLogPatches(disabledPatches: string, customPatches: string) {
    return Native.applyPatches(disabledPatches, customPatches).then(result => {
        if (result.revert_before_apply) {
            logRevertSummary(result.revert_before_apply, "Reverting previously tracked patches before apply");
        }

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

        logPatchRows(result);

        console.log(
            `[VoicePatcher] Done — ok:${result.ok} failed:${result.failed} skipped:${result.skipped}` +
            `${typeof result.tracked === "number" ? ` tracked:${result.tracked}` : ""}`
        );
        return result;
    });
}

export function revertAndLogPatches() {
    return Native.revertPatches().then(result => {
        if (result.error) {
            console.error("[VoicePatcher] Revert error:", result.error);
            return result;
        }

        console.log(`[VoicePatcher] Module: ${result.module_base} (${result.module_size})`);
        console.log(`[VoicePatcher] Assets: ${result.assetSource}`);
        logRevertSummary(result, "Reverting all tracked patches");
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
    },
    stop() {
        revertAndLogPatches().catch(e => {
            console.error("[VoicePatcher] Failed to revert patches on stop:", e);
        });
    }
});
