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
import { PluginInfo } from "@plugins/betterScreenshare.desktop/constants";
import { openScreenshareModal } from "@plugins/betterScreenshare.desktop/modals";
import { ScreenshareAudioPatcher, ScreensharePatcher } from "@plugins/betterScreenshare.desktop/patchers";
import { GoLivePanelWrapper, replacedSubmitFunction } from "@plugins/betterScreenshare.desktop/patches";
import { initScreenshareAudioStore, initScreenshareStore } from "@plugins/betterScreenshare.desktop/stores";
import { addSettingsPanelButton, Emitter, removeSettingsPanelButton, ScreenshareSettingsIcon } from "@plugins/philsPluginLibrary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";

const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

function screenshareSettingsButton(props: { nameplate?: any; }) {
    const { buttonLocation } = settings.use(["buttonLocation"]);
    if (buttonLocation !== "voicePanel" && buttonLocation !== "both") return null;

    return (
        <PanelButton
            tooltipText="Screenshare Settings"
            icon={ScreenshareSettingsIcon}
            role="button"
            plated={props?.nameplate != null}
            onClick={openScreenshareModal}
        />
    );
}

const settings = definePluginSettings({
    buttonLocation: {
        type: OptionType.SELECT,
        description: "Where to show the Screenshare Settings button",
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
                    icon: ScreenshareSettingsIcon,
                    tooltipText: "Screenshare Settings",
                    onClick: openScreenshareModal
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
                onClick={() => openScreenshareModal()}
            >
                Open Screenshare Settings
            </Button>
        )
    }
});

export default definePlugin({
    name: "BetterScreenshare",
    description: "This plugin allows you to further customize your screen sharing.",
    authors: [Devs.philhk],
    dependencies: ["PhilsPluginLibrary"],
    patches: [
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /speaking:.{0,100}style:.,children:\[/,
                replace: "$&$self.screenshareSettingsButton(arguments[0]),"
            }
        }
    ],
    settings,
    start(): void {
        initScreenshareStore();
        initScreenshareAudioStore();
        this.screensharePatcher = new ScreensharePatcher().patch();
        this.screenshareAudioPatcher = new ScreenshareAudioPatcher().patch();

        const loc = settings.store.buttonLocation;
        if (loc === "settingsPanel" || loc === "both") {
            addSettingsPanelButton({
                name: PluginInfo.PLUGIN_NAME,
                icon: ScreenshareSettingsIcon,
                tooltipText: "Screenshare Settings",
                onClick: openScreenshareModal
            });
        }
    },
    stop(): void {
        this.screensharePatcher?.unpatch();
        this.screenshareAudioPatcher?.unpatch();
        Emitter.removeAllListeners(PluginInfo.PLUGIN_NAME);
        removeSettingsPanelButton(PluginInfo.PLUGIN_NAME);
    },
    toolboxActions: {
        "Open Screenshare Settings": openScreenshareModal
    },
    replacedSubmitFunction,
    GoLivePanelWrapper,
    screenshareSettingsButton: ErrorBoundary.wrap(screenshareSettingsButton, { noop: true }),
});
