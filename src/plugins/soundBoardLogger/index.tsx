/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import { IconWithTooltip, LogIcon } from "@plugins/soundBoardLogger/components/Icons";
import { openSoundBoardLog } from "@plugins/soundBoardLogger/components/SoundBoardLog";
import settings from "@plugins/soundBoardLogger/settings";
import { updateLoggedSounds } from "@plugins/soundBoardLogger/store";
import { getListeners } from "@plugins/soundBoardLogger/utils";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

import styles from "./styles.css?managed"; // CSS must be imported relatively; the build's style plugin doesn't resolve the @plugins alias

export default definePlugin({
    name: "SoundBoardLogger",
    authors: [
        Devs.Fres,
        Devs.echo
    ],
    settings,
    patches: [
        {
            find: "\"chat-spacer\"",
            replacement: {
                match: /\)\),\(0,(\w{1,3})\.(\w{1,3})\)\((\w{1,3})\.(\w{1,3}),{value:(\w{1,3}),children:(\w{1,3})}\)\}\}/,
                replace: ")),$6.unshift($self.getComp()),(0,$1.$2)($3.$4,{value:$5,children:$6})}}"
            }
        }
    ],
    description: "Logs all soundboards that are played in a voice chat and allows you to download them",
    start() {
        enableStyle(styles);
        FluxDispatcher.subscribe("VOICE_CHANNEL_EFFECT_SEND", async sound => {
            if (!sound?.soundId) return;
            await updateLoggedSounds(sound);
            getListeners().forEach(cb => cb());
        });
    },
    stop() {
        disableStyle(styles);
    },
    getComp() {
        return <IconWithTooltip text="Open SoundBoard Log" icon={<LogIcon />} onClick={openSoundBoardLog} />;
    }
});
