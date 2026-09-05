/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { dashBeamAccessory } from "@plugins/dashbeam.desktop/accessory";
import { ctxMenuPatch } from "@plugins/dashbeam.desktop/contextMenu";
import { managedStyle } from "@plugins/dashbeam.desktop/progressCard";
import { resetRuntimeState, stopShare } from "@plugins/dashbeam.desktop/shareState";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "DashBeam",
    description: "P2P file sharing via dashbeam's iroh wasm bridge. Share files from the channel + menu as a ticket link — plugin users see an embed card with metadata and Accept/Decline, everyone else can open the link in any browser.",
    authors: [Devs.Loukious],
    dependencies: ["MessageAccessoriesAPI"],
    managedStyle,
    contextMenus: {
        "channel-attach": ctxMenuPatch,
    },
    start() {
        // Position 4, just above rich embeds — same slot messageLinkEmbeds uses
        addMessageAccessory("DashBeam", dashBeamAccessory, 4);
    },
    stop() {
        removeMessageAccessory("DashBeam");
        stopShare();
        resetRuntimeState();
    },
});
