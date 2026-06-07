/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { cl, getEmojiUrl, SoundLogEntry, User } from "@plugins/soundBoardLogger/utils";
import { RenderModalProps } from "@vencord/discord-types";
import { Clickable, Modal, openModal } from "@webpack/common";

export function openMoreUsersModal(item: SoundLogEntry, users: User[], onClickUser: Function) {
    openModal(props => (
        <ErrorBoundary>
            <MoreUsersModal item={item} users={users} onClickUser={onClickUser} modalProps={props} />
        </ErrorBoundary>
    ));
}


export default function MoreUsersModal({ item, users, onClickUser, modalProps }: { item: SoundLogEntry, users: User[], onClickUser: Function, modalProps: RenderModalProps; }) {
    return (
        <Modal
            {...modalProps}
            title={
                <div className={cl("more-header")}>
                    <img
                        className={cl("more-emoji")}
                        src={getEmojiUrl(item.emoji)}
                        alt=""
                    />
                    <Heading tag="h2" className={cl("more-soundId")}>{item.soundId}</Heading>
                </div>
            }
        >
            <div className={cl("more")}>
                <div className={cl("more-users")}>
                    {users.map(user => {
                        const currentUser = item.users.find(({ id }) => id === user.id) ?? { id: "", plays: [0] };
                        return (
                            <Clickable
                                key={user.id} // Added unique key here
                                onClick={() => {
                                    modalProps.onClose();
                                    onClickUser(item, user);
                                }}
                            >
                                <div className={cl("more-user")} style={{ cursor: "pointer" }}>
                                    <Flex flexDirection="row" className={cl("more-user-profile")}>
                                        <img
                                            className={cl("user-avatar")}
                                            src={user.getAvatarURL(void 0, 512, true)}
                                            alt=""
                                            style={{ cursor: "pointer" }}
                                        />
                                        <Paragraph size="md" style={{ cursor: "pointer" }}>{user.username}</Paragraph>
                                    </Flex>
                                    <Paragraph size="md" style={{ cursor: "pointer" }}>
                                        Played {currentUser.plays.length} {currentUser.plays.length === 1 ? "time" : "times"}
                                    </Paragraph>
                                </div>
                            </Clickable>
                        );
                    })}
                </div>
            </div>
        </Modal>
    );
}
