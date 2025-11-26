/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { definePluginSettings } from "@api/Settings";
import { PluginInfo } from "@plugins/betterMicrophone.desktop/constants";
import { openMicrophoneSettingsModal } from "@plugins/betterMicrophone.desktop/modals";
import { MicrophonePatcher } from "@plugins/betterMicrophone.desktop/patchers";
import { initMicrophoneStore } from "@plugins/betterMicrophone.desktop/stores";
import { Emitter, MicrophoneSettingsIcon } from "@plugins/philsPluginLibrary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";

const Button = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");

function micSettingsButton() {
    const { hideSettingsIcon } = settings.use(["hideSettingsIcon"]);
    if (hideSettingsIcon) return null;
    return (
        <Button
            tooltipText="Change screenshare settings"
            icon={MicrophoneSettingsIcon}
            role="button"
            onClick={openMicrophoneSettingsModal}
        />
    );
}

const settings = definePluginSettings({
    hideSettingsIcon: {
        type: OptionType.BOOLEAN,
        description: "Hide the settings icon",
        default: true,
    }
});

export default definePlugin({
    name: "BetterMicrophone",
    description: "This plugin allows you to further customize your microphone.",
    authors: [Devs.philhk],
    dependencies: ["PhilsPluginLibrary"],
    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /className:\i\.buttons,.{0,50}children:\[/,
                replace: "$&$self.micSettingsButton(),"
            }
        }
    ],
    settings: settings,
    start(): void {
        initMicrophoneStore();

        this.microphonePatcher = new MicrophonePatcher().patch();
    },
    stop(): void {
        this.microphonePatcher?.unpatch();

        Emitter.removeAllListeners(PluginInfo.PLUGIN_NAME);
    },
    toolboxActions: {
        "Open Microphone Settings": openMicrophoneSettingsModal
    },
    micSettingsButton
});
