/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { clearLoggedSounds, getLoggedSounds } from "@plugins/soundBoardLogger/store";
import { addListener, AvatarStyles, cl, downloadAudio, getEmojiUrl, getSoundboardVolume, playSound, removeListener, SoundLogEntry } from "@plugins/soundBoardLogger/utils";
import { copyWithToast } from "@utils/discord";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { User } from "@vencord/discord-types";
import { Clickable, ContextMenuApi, FluxDispatcher, Menu, Tooltip, useEffect, UserSummaryItem, UserUtils, useState } from "@webpack/common";

import { openCloneSoundModal } from "./CloneSoundModal";
import { openMoreUsersModal } from "./MoreUsersModal";
import { openUserModal } from "./UserModal";

export async function openSoundBoardLog(): Promise<void> {

    const data = await getLoggedSounds();
    const key = openModal(props => <ErrorBoundary>
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <SoundBoardLog data={data} closeModal={() => closeModal(key)} />
        </ModalRoot>
    </ErrorBoundary>);

}

export default function SoundBoardLog({ data, closeModal }) {
    const [sounds, setSounds] = useState(data);
    const [users, setUsers] = useState<User[]>([]);
    const update = async () => setSounds(await getLoggedSounds());

    // Update the sounds state when a new sound is played
    useEffect(() => {
        const onSound = () => update();
        addListener(onSound);
        return () => removeListener(onSound);
    }, []);

    const avatarsMax = 2;

    // Update the users state when a new sound is played
    useEffect(() => {
        (async () => {
            /** Array of user IDs without a resolved user object */
            const missing = sounds
                .flatMap(sound => sound.users) // Get all users who have used any sound
                .map(user => user.id) // Get their ID ( user is {id: string, plays: number[]} )
                .filter((id, index, self) => index === self.indexOf(id)) // Filter the array to remove non unique values
                .filter(id => !users.map(user => user.id).includes(id)); // Filter the IDs to only get the ones not already in the users state
            if (!missing.length) return; // return if every user ID is already in users

            for (const id of missing) {
                const user = await UserUtils.getUser(id).catch(() => void 0);
                if (user) setUsers(u => [...u, user]);
            }
        })();
    }, [sounds]);

    function renderMoreUsers(item, itemUsers) {
        return (
            <Clickable
                className={AvatarStyles.clickableAvatar}
                onClick={() => {
                    onClickShowMoreUsers(item, itemUsers);
                }}
            >
                <Tooltip text={`${itemUsers.length - avatarsMax} other people used this sound...`}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <div
                            className={AvatarStyles.moreUsers}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                        >
                            +{itemUsers.length - avatarsMax}
                        </div>
                    )}
                </Tooltip>
            </Clickable>
        );
    }

    /** This function is called when you click the "Show more users" button. */
    function onClickShowMoreUsers(item: SoundLogEntry, users: User[]): void {
        openMoreUsersModal(item, users, onClickUser);
    }

    function onClickUser(item: SoundLogEntry, user: User) {
        openUserModal(item, user, sounds);
    }

    function SoundContextMenu({ item }) {
        const label = id => `soundboardlogger-${id}`;
        return (
            <Menu.Menu
                navId="soundboardlogger-sound-menu"
                onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            >
                <Menu.MenuGroup label="Extra buttons">
                    <Menu.MenuItem
                        id={label("clone")}
                        label="Clone sound"
                        action={() => openCloneSoundModal(item)}
                    />
                </Menu.MenuGroup>
            </Menu.Menu>
        );
    }

    return (
        <>
            <ModalHeader className={cl("modal-header")}>
                <Heading tag="h2" style={{ flexGrow: 1 }}>SoundBoard log</Heading>
                <ModalCloseButton onClick={closeModal} />
            </ModalHeader>
            <ModalContent className={classes(cl("modal-content"), Margins.top8)}>
                {sounds.length ? sounds.map(item => {
                    const itemUsers = users.filter(user => item.users.map(u => u.id).includes(user.id));

                    return (
                        <div
                            key={item.soundId}
                            className={cl("sound")}
                            onContextMenu={e =>
                                ContextMenuApi.openContextMenu(e, () => <SoundContextMenu item={item} />)
                            }
                        >
                            <Flex flexDirection="row" className={cl("sound-info")}>
                                <img
                                    src={getEmojiUrl(item.emoji)}
                                    className={cl("sound-emoji")}
                                />
                                <Paragraph size="md" className={cl("sound-id")}>{item.soundId}</Paragraph>
                            </Flex>
                            <UserSummaryItem
                                users={itemUsers.slice(0, avatarsMax)} // Trimmed array to the size of max
                                count={item.users.length - 1} // True size (counting users that aren't rendered) - 1
                                guildId={undefined}
                                renderIcon={false}
                                max={avatarsMax}
                                showDefaultAvatarsForNullUsers
                                showUserPopout
                                renderMoreUsers={() => renderMoreUsers(item, itemUsers)}
                                className={cl("sound-users")}
                                renderUser={(user: User) => (
                                    <Clickable
                                        key={user.id} // Add a unique key for each user
                                        className={AvatarStyles.clickableAvatar}
                                        onClick={() => {
                                            onClickUser(item, user);
                                        }}
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
                            <Flex flexDirection="row" className={cl("sound-buttons")}>
                                <Button variant="primary" size="small" onClick={() => downloadAudio(item.soundId)}>Download</Button>
                                <Button variant="positive" size="small" onClick={() => copyWithToast(item.soundId, "ID copied to clipboard!")}>Copy ID</Button>
                                <Tooltip text={`Soundboard volume: ${Math.floor(getSoundboardVolume())}%`}>
                                    {({ onMouseEnter, onMouseLeave }) =>
                                        <Button variant="primary" size="small" onClick={() => playSound(item.soundId)} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>Play Sound</Button>
                                    }
                                </Tooltip>
                            </Flex>
                        </div>
                    );
                }) :
                    <div style={{ textAlign: "center" }} className={Margins.top16}>
                        <img
                            src="https://raw.githubusercontent.com/fres621/assets/main/shiggy.png"
                            height="200px"
                        />
                        <Paragraph size="md" style={{ color: "var(--text-muted)" }} className={Margins.bottom16}>No sounds logged yet. Join a voice chat to start logging!</Paragraph>
                    </div>
                }
            </ModalContent >
            <ModalFooter className={cl("modal-footer")}>
                <Button variant="dangerPrimary" onClick={async () => { await clearLoggedSounds(); update(); }}>
                    Clear logs
                </Button>
            </ModalFooter>
        </>
    );
}
