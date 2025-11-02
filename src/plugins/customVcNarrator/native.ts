/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export async function getAudio(_, text: string, selectedVoiceValue: string): Promise<string> {
    if (!text || !selectedVoiceValue) throw new Error("Text or voice not provided");

    const url = "https://ttsvibes.com/?/generate";
    const body = new URLSearchParams({ text, selectedVoiceValue }).toString();

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "origin": "https://ttsvibes.com" },
        body
    });

    if (!response.ok) throw new Error(`TTS API error: ${response.status} ${response.statusText}`);

    const data = await response.json();
    if (data.type !== "success" || data.status !== 200) {
        throw new Error(data?.error || "Unknown TTS API error");
    }

    const parsedData = JSON.parse(data.data);
    return parsedData[2]; // base64 audio
}
