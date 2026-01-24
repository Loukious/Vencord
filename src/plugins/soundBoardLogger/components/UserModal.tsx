/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { CopyIcon } from "@components/Icons";
import { AvatarStyles, cl, downloadAudio, getEmojiUrl, playSound, SoundLogEntry, User } from "@plugins/soundBoardLogger/utils";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { closeModal, ModalContent, ModalRoot, openModal } from "@utils/modal";
import { Clickable, Timestamp, UserSummaryItem } from "@webpack/common";
import moment from "moment";

import { DownloadIcon, IconWithTooltip, PlayIcon } from "./Icons";

export function openUserModal(item, user, sounds) {
    const key = openModal(props =>
        <ModalRoot {...props}>
            <UserModal item={item} user={user} sounds={sounds} closeModal={() => closeModal(key)} />
        </ModalRoot>
    );
}

export default function UserModal({ item, user, sounds, closeModal }: { item: SoundLogEntry, user: User, sounds: SoundLogEntry[], closeModal: Function; }) {
    const currentUser = item.users.find(({ id }) => id === user.id) ?? { id: "", plays: [0] };
    const soundsDoneByCurrentUser = sounds.filter(sound => sound.users.some(itemUser => itemUser.id === user.id) && sound.soundId !== item.soundId);

    return (
        <ModalContent className={cl("user")}>
            <Clickable onClick={() => {
                closeModal();
                openUserProfile(user.id);
            }}>
                <div className={cl("user-header")}>
                    <img
                        className={cl("user-avatar")}
                        src={user.getAvatarURL(void 0, 512, true)}
                        alt=""
                        style={{ cursor: "pointer" }}
                    />
                    <Heading tag="h2" className={cl("user-name")} style={{ textTransform: "none", cursor: "pointer" }}>{user.username}</Heading>
                </div>
            </Clickable>
            <Flex flexDirection="row" style={{ gap: "10px" }}>
                <img
                    className={cl("user-sound-emoji")}
                    src={getEmojiUrl(item.emoji)}
                    alt=""
                />
                <Flex flexDirection="column" style={{ gap: "7px", height: "68px", justifyContent: "space-between" }}>
                    <BaseText weight="bold" style={{ height: "20px" }}>{item.soundId}</BaseText>
                    <BaseText>Played {currentUser.plays.length} {currentUser.plays.length === 1 ? "time" : "times"}.</BaseText>
                    <BaseText>Last played: <Timestamp timestamp={new Date(moment(currentUser.plays.at(-1)).toDate())} /></BaseText>
                </Flex>
            </Flex>
            <Heading tag="h2" className={classes(Margins.top16, Margins.bottom8)}>
                {soundsDoneByCurrentUser.length ? "Also played:" : " "}
            </Heading>
            <Flex style={{ justifyContent: "space-between" }}>
                <UserSummaryItem
                    users={soundsDoneByCurrentUser}
                    count={soundsDoneByCurrentUser.length}
                    guildId={undefined}
                    renderIcon={false}
                    max={10}
                    showDefaultAvatarsForNullUsers
                    showUserPopout
                    renderMoreUsers={() =>
                        <div className={AvatarStyles.emptyUser}>
                            <div className={AvatarStyles.moreUsers}>
                                ...
                            </div>
                        </div>
                    }
                    className={cl("user-sounds")}
                    renderUser={({ soundId, emoji }) => (
                        <Clickable
                            className={AvatarStyles.clickableAvatar}
                            onClick={() => {
                                closeModal();
                                openUserModal(sounds.find(sound => sound.soundId === soundId), user, sounds);
                            }}
                        >
                            <img
                                className={AvatarStyles.avatar}
                                src={getEmojiUrl(emoji)}
                                alt={soundId}
                                title={soundId}
                            />
                        </Clickable>
                    )}
                />
                <div className={cl("user-buttons")}>
                    <IconWithTooltip text="Download" icon={<DownloadIcon />} onClick={() => downloadAudio(item.soundId)} />
                    <IconWithTooltip text="Copy ID" icon={<CopyIcon />} onClick={() => copyWithToast(item.soundId, "ID copied to clipboard!")} />
                    <IconWithTooltip text="Play Sound" icon={<PlayIcon />} onClick={() => playSound(item.soundId)} />
                </div>
            </Flex>
        </ModalContent>
    );
}
