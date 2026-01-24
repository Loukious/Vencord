/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { proxyLazy } from "@utils/lazy";
import { saveFile } from "@utils/web";
import type { User } from "@vencord/discord-types";
import { findByCodeLazy, findByProps, findCssClassesLazy } from "@webpack";

import settings from "./settings";

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

const amplitudeToPerceptual = findByCodeLazy("20*Math.log10(");
const getAmplitudinalSoundboardVolume = findByCodeLazy(".getSetting();return null", "100");

export const getSoundboardVolume = () => amplitudeToPerceptual(getAmplitudinalSoundboardVolume());

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
