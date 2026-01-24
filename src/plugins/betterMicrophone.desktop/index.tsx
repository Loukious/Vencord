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
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { PluginInfo } from "@plugins/betterMicrophone.desktop/constants";
import { openMicrophoneSettingsModal } from "@plugins/betterMicrophone.desktop/modals";
import { MicrophonePatcher } from "@plugins/betterMicrophone.desktop/patchers";
import { initMicrophoneStore } from "@plugins/betterMicrophone.desktop/stores";
import { addSettingsPanelButton, Emitter, MicrophoneSettingsIcon, removeSettingsPanelButton } from "@plugins/philsPluginLibrary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";

const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

function micSettingsButton(props: { nameplate?: any; }) {
    const { buttonLocation } = settings.use(["buttonLocation"]);
    if (buttonLocation !== "voicePanel" && buttonLocation !== "both") return null;
    return (
        <PanelButton
            tooltipText="Microphone Settings"
            icon={MicrophoneSettingsIcon}
            role="button"
            plated={props?.nameplate != null}
            onClick={openMicrophoneSettingsModal}
        />
    );
}

const settings = definePluginSettings({
    buttonLocation: {
        type: OptionType.SELECT,
        description: "Where to show the Microphone Settings button",
        options: [
            { label: "Above your avatar", value: "settingsPanel", default: true },
            { label: "Beside your avatar", value: "voicePanel", default: false },
            { label: "Both", value: "both", default: false },
            { label: "None", value: "none", default: false }
        ],
        onChange: (value: string) => {
            if (value === "settingsPanel" || value === "both") {
                addSettingsPanelButton({
                    name: PluginInfo.PLUGIN_NAME,
                    icon: MicrophoneSettingsIcon,
                    tooltipText: "Microphone Settings",
                    onClick: openMicrophoneSettingsModal
                });
            } else {
                removeSettingsPanelButton(PluginInfo.PLUGIN_NAME);
            }
        }
    },
    openSettings: {
        type: OptionType.COMPONENT,
        component: () => (
            <Button
                onClick={() => openMicrophoneSettingsModal()}
            >
                Open Microphone Settings
            </Button>
        )
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
                match: /speaking:.{0,100}style:.,children:\[/,
                replace: "$&$self.micSettingsButton(arguments[0]),"
            }
        }
    ],
    settings: settings,
    start(): void {
        initMicrophoneStore();

        this.microphonePatcher = new MicrophonePatcher().patch();

        const loc = settings.store.buttonLocation;
        if (loc === "settingsPanel" || loc === "both") {
            addSettingsPanelButton({ name: PluginInfo.PLUGIN_NAME, icon: MicrophoneSettingsIcon, tooltipText: "Microphone Settings", onClick: openMicrophoneSettingsModal });
        }
    },
    stop(): void {
        this.microphonePatcher?.unpatch();

        Emitter.removeAllListeners(PluginInfo.PLUGIN_NAME);

        removeSettingsPanelButton(PluginInfo.PLUGIN_NAME);
    },
    toolboxActions: {
        "Open Microphone Settings": openMicrophoneSettingsModal
    },
    micSettingsButton: ErrorBoundary.wrap(micSettingsButton, { noop: true }),
});
