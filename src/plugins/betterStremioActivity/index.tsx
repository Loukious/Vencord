/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getUserSettingLazy } from "@api/UserSettings";
import { Button } from "@components/Button";
import { ErrorCard } from "@components/ErrorCard";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { React } from "@webpack/common";


const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame")!;


export default definePlugin({
    name: "BetterStremioActivity",
    description: "Replaces Stremio's RPC activity with the current movie/series name instead of 'Watching Stremio'.",
    authors: [Devs.Loukious],


    patches: [
        {
            find: ',"LocalActivityStore");',
            replacement: {
                match: /LOCAL_ACTIVITY_UPDATE:(\i)/,
                replace: "LOCAL_ACTIVITY_UPDATE:$self.interceptActivity($1)",
            }
        }
    ],


    interceptActivity(originalHandler: Function) {
        return (activityData: { activity: any, socketId: string; }) => {
            if (activityData?.activity) {
                if (activityData.activity.name === "Stremio") {
                    if (activityData.activity.timestamps?.end || activityData.activity.state?.toLowerCase().includes("paused") || activityData.activity.assets?.small_text?.toLowerCase().includes("paused")) {
                        activityData.activity.name = activityData.activity.details;

                        if (activityData.activity.state) {
                            activityData.activity.details = activityData.activity.state;
                        }

                        if (activityData.activity.assets?.small_text) {
                            activityData.activity.state = activityData.activity.assets.small_text;
                        }
                    }
                }
            }
            return originalHandler.call(this, activityData);
        };
    },

    settingsAboutComponent: () => {
        const gameActivityEnabled = ShowCurrentGame.useSetting();

        return (
            <>
                {!gameActivityEnabled && (
                    <ErrorCard
                        className={classes(Margins.top16, Margins.bottom16)}
                        style={{ padding: "1em" }}
                    >
                        <Heading>Notice</Heading>
                        <Paragraph>Activity Sharing isn't enabled, people won't be able to see your custom rich presence!</Paragraph>

                        <Button
                            variant="secondary"
                            className={Margins.top8}
                            onClick={() => ShowCurrentGame.updateSetting(true)}
                        >
                            Enable
                        </Button>
                    </ErrorCard>
                )}

                <Flex flexDirection="column" style={{ display: "flex", flexDirection: "column", gap: "1em", fontSize: "15px", lineHeight: "1.6" }} className={Margins.top16}>
                    <Paragraph>
                        For this to work you will need <Link href="https://github.com/Loukious/stremio-shell-ng">this Stremio fork</Link>
                    </Paragraph>
                    <Paragraph>
                        After installing the fork, simply enable this plugin and it will automatically replace the Stremio activity with the current movie/series name.
                    </Paragraph>
                </Flex>

            </>
        );
    }

});
