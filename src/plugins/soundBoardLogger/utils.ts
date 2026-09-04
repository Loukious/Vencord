/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import settings from "@plugins/soundBoardLogger/settings";
import { classNameFactory } from "@utils/css";
import { proxyLazy } from "@utils/lazy";
import { saveFile } from "@utils/web";
import type { User } from "@vencord/discord-types";
import { filters, findByProps, findCssClassesLazy, findStoreLazy, waitFor } from "@webpack";

export { User };

export interface SoundEvent {
    type: "VOICE_CHANNEL_EFFECT_SEND",
    emoji: { name: string, id?: string, animated: boolean; },
    channelId: string,
    userId: string,
    animationType: number,
    animationId: number,
    soundId: string,
    soundVolume: number;
}

export interface SoundLogEntry extends SoundEvent {
    users: { id: string, plays: number[]; }[];
}


export const cl = classNameFactory("vc-soundlog-");

export function getEmojiUrl(emoji) {
    const { getURL } = proxyLazy(() => findByProps("getEmojiColors", "getURL"));
    if (!emoji) return getURL("❓"); // If the sound doesn't have a related emoji
    return emoji.id ? `https://cdn.discordapp.com/emojis/${emoji.id}.png?size=32` : getURL(emoji.name);
}

// Discord's perceptual volume curve. The module used to be findable eagerly,
// but it lives in a lazily loaded chunk and can be absent when the log is
// first rendered, so fall back to a local copy of the formula
// (n < 1 ? n^(1/2.8) : (20 * log10(n)) / 6 + 1, unique via its exponent
// constant) and swap in Discord's own function once its chunk registers
let amplitudeToPerceptual: (volume: number, max?: number) => number = (volume, max = 100) => {
    if (volume === 0) return 0;
    const n = volume / max;
    return (n < 1 ? Math.pow(n, 0.35714285714285715) : (20 * Math.log10(n)) / 6 + 1) * max;
};
waitFor(filters.byCode("0.35714285714285715"), (mod: any) => {
    amplitudeToPerceptual = mod;
});

// The client used to have a dedicated exported "get soundboard volume" function;
// it now reads the setting inline from the preloaded user settings proto
const UserSettingsProtoStore = findStoreLazy("UserSettingsProtoStore");

export const getSoundboardVolume = () => {
    const volume = UserSettingsProtoStore?.settings?.voiceAndVideo?.soundboardSettings?.volume;
    return amplitudeToPerceptual(volume ?? 100);
};

export const SoundboardStore = findStoreLazy("SoundboardStore");

/** Resolves a sound's name from the client's soundboard cache, falling back to its ID */
export const getSoundName = (soundId: string) =>
    SoundboardStore?.getSoundById?.(soundId)?.name ?? soundId;

export const playSound = id => {
    const audio = new Audio(`https://cdn.discordapp.com/soundboard-sounds/${id}`);
    audio.volume = getSoundboardVolume() / 100;
    audio.play();
};

export async function downloadAudio(id: string): Promise<void> {
    const filename = id + settings.store.FileType;
    const data = await fetch(`https://cdn.discordapp.com/soundboard-sounds/${id}`).then(e => e.arrayBuffer());


    if (IS_DISCORD_DESKTOP) {
        DiscordNative.fileManager.saveWithDialog(data, filename);
    } else {
        saveFile(new File([data], filename, { type: "audio/ogg" }));
    }
}

let listeners: Function[] = [];

export function getListeners(): Function[] {
    return listeners;
}

export function addListener(fn): void {
    listeners.push(fn);
}

export function removeListener(fn): void {
    listeners = listeners.filter(f => f !== fn);
}

export const AvatarStyles = findCssClassesLazy("moreUsers", "emptyUser", "avatarContainer", "clickableAvatar", "avatar");
