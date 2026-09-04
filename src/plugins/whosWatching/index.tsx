/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { getIntlMessage, openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findComponentByCodeLazy, findCssClassesLazy, findStoreLazy } from "@webpack";
import { Clickable, RelationshipStore, Tooltip, UserStore, useStateFromStores } from "@webpack/common";
import type { JSX } from "react";

interface WatchingProps {
    userIds: string[];
    guildId?: string;
}

const cl = classNameFactory("whosWatching-");

function getUsername(user: any): string {
    return RelationshipStore.getNickname(user.id) || user.globalName || user.username;
}

const settings = definePluginSettings({
    showPanel: {
        description: "Show spectators under screenshare panel",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: true
    },
});

function Watching({ userIds, guildId }: WatchingProps): JSX.Element {
    // Missing Users happen when UserStore.getUser(id) returns null
    // The client should automatically cache spectators, so this might not be possible but it's better to be sure just in case
    let missingUsers = 0;
    const users = userIds.map(id => UserStore.getUser(id)).filter(user => Boolean(user) ? true : (missingUsers += 1, false));
    return (
        <div className={cl("content")}>
            {userIds.length ?
                (<>
                    <Heading>{getIntlMessage("SPECTATORS", { numViewers: userIds.length })}</Heading>
                    <Flex flexDirection="column" style={{ gap: 6 }} >
                        {users.map(user => (
                            <Flex key={user.id} flexDirection="row" style={{ gap: 6, alignContent: "center" }} className={cl("user")} >
                                <img src={user.getAvatarURL(guildId)} style={{ borderRadius: 8, width: 16, height: 16 }} />
                                {getUsername(user)}
                            </Flex>
                        ))}
                        {missingUsers > 0 && <span className={cl("more_users")}>{`+${getIntlMessage("NUM_USERS", { num: missingUsers })}`}</span>}
                    </Flex>
                </>)
                : (<span className={cl("no_viewers")}>No spectators</span>)}
        </div>
    );
}

const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");

const UserSummaryItem = findComponentByCodeLazy("defaultRenderUser", "showDefaultAvatarsForNullUsers");
const ActivityPanelStyles = findCssClassesLazy("activityPanel");
const AvatarStyles = findCssClassesLazy("moreUsers", "clickableAvatar", "avatar");

export default definePlugin({
    name: "WhosWatching",
    description: "Hover over the screenshare icon to view what users are watching your stream",
    authors: [
        Devs.Fres,
        Devs.Loukious
    ],
    settings: settings,
    patches: [
        {
            find: ".Masks.STATUS_SCREENSHARE,width:32",
            replacement: {
                match: /jsx\)\((\i\.\i),{mask:/,
                replace: "jsx)($self.component({OriginalComponent:$1}),{mask:"
            }
        },
        { // New panel patch
            // The activity panel was rewritten from a class component (whose
            // renderVoicePanelIntroduction method this used to anchor on) into
            // a function component; it now renders a single outer div with a
            // classnames() className and a popout ref, wrapping the status
            // card, the panel buttons and the popovers
            predicate: () => settings.store.showPanel,
            find: "AutoclippingAccountPanelCoachmark",
            replacement: {
                match: /jsx\)\("div",\{className:(\i)\(\)\((\i)\.(\i),(\i)\),ref:(\i),/,
                replace: "jsx)($self.WrapperComponent,{className:$1()($2.$3,$4),ref:$5,"
            }
        }
    ],
    WrapperComponent: ErrorBoundary.wrap(props => {
        const stream = useStateFromStores([ApplicationStreamingStore], () => ApplicationStreamingStore.getCurrentUserActiveStream());
        if (!stream) return <div {...props}>{props.children}</div>;

        const userIds: string[] = ApplicationStreamingStore.getViewerIds(stream);
        let missingUsers = 0;
        const users = userIds.map(id => UserStore.getUser(id)).filter(user => Boolean(user) ? true : (missingUsers += 1, false));

        function renderMoreUsers(_label: string, count: number) {
            const sliced = users.slice(count - 1);
            return (
                <Tooltip text={<Watching userIds={userIds} guildId={stream.guildId} />}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <div
                            className={AvatarStyles.moreUsers}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                        >
                            +{sliced.length + missingUsers}
                        </div>
                    )}
                </Tooltip>
            );
        }

        return (
            <>
                {/* The wrapped div is the activity panel (stream status card + its
                    buttons); the spectators section goes after it, landing between
                    the stream panel and the "Voice Connected" panel below.
                    The activityPanel class carries a border-bottom separator; drop
                    it here so the panels don't get a divider between them (our own
                    div below keeps its border, separating it from Voice Connected) */}
                <div {...props} style={{ ...props.style, borderBottom: "none" }}>{props.children}</div>
                <div className={classes(cl("spectators_panel"), ActivityPanelStyles.activityPanel)}>
                    {users.length ?
                        <>
                            <Heading tag="h3" style={{ marginTop: 0, marginBottom: 0, textTransform: "uppercase" }}>
                                {getIntlMessage("SPECTATORS", { numViewers: userIds.length })}
                            </Heading>
                            <UserSummaryItem
                                users={users}
                                count={userIds.length}
                                renderIcon={false}
                                max={12}
                                showDefaultAvatarsForNullUsers
                                renderMoreUsers={renderMoreUsers}
                                renderUser={(user: User) => (
                                    <Clickable
                                        className={AvatarStyles.clickableAvatar}
                                        onClick={() => openUserProfile(user.id)}
                                    >
                                        <img
                                            className={AvatarStyles.avatar}
                                            src={user.getAvatarURL(void 0, 80, true)}
                                            alt={user.username}
                                            title={user.username}
                                        />
                                    </Clickable>
                                )}
                            />
                        </>
                        : <Paragraph>No spectators</Paragraph>
                    }
                </div>
            </>
        );
    }),
    component: function ({ OriginalComponent }) {
        return ErrorBoundary.wrap((props: any) => {
            const stream = useStateFromStores(
                [ApplicationStreamingStore],
                () => ApplicationStreamingStore.getCurrentUserActiveStream()
            );
            if (!stream) return null;
            const viewers = ApplicationStreamingStore.getViewerIds(stream);
            return <Tooltip text={<Watching userIds={viewers} guildId={stream.guildId} />}>
                {({ onMouseEnter, onMouseLeave }) => (
                    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
                        <OriginalComponent {...props} />
                    </div>
                )}
            </Tooltip>;
        });
    }
});
