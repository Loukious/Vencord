/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { OpenExternalIcon } from "@components/Icons";
import { shareFile } from "@plugins/dashbeam.desktop/shareState";
import { Menu, PermissionsBits, PermissionStore, SelectedChannelStore, showToast } from "@webpack/common";

// Hidden file picker → shareFile into the current channel (same pattern as
// biggerFileUpload's triggerFileUpload)
function triggerDashBeamShare() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.display = "none";

    fileInput.onchange = async event => {
        const target = event.target as HTMLInputElement;
        if (target?.files?.length) {
            const file = target.files[0];
            if (file) {
                await shareFile(file, SelectedChannelStore.getChannelId());
            }
        } else {
            showToast("No file selected");
        }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

export const ctxMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (props.channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, props.channel)) return;

    children.splice(1, 0,
        <Menu.MenuItem
            id="dashbeam-share"
            iconLeft={OpenExternalIcon}
            leadingAccessory={{
                type: "icon",
                icon: OpenExternalIcon
            }}
            label="Share via DashBeam"
            action={triggerDashBeamShare}
        />
    );
};
