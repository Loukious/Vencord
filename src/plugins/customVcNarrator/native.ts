/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export async function getAudio(_, text: string, selectedVoiceValue: string): Promise<string> {
    if (!text || !selectedVoiceValue) throw new Error("Text or voice not provided");

    const response = await fetch("https://ottsy.weilbyte.dev/api/generation", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "origin": "https://ottsy.weilbyte.dev"
        },
        body: JSON.stringify({
            text,
            voice: selectedVoiceValue
        })
    });

    if (!response.ok) throw new Error(`TTS API error: ${response.status} ${response.statusText}`);

    const data = await response.json();

    if (!data?.success) {
        throw new Error(data?.error || "Unknown TTS API error");
    }

    return data.data;
}
