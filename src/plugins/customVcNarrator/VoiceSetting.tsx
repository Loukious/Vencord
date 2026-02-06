/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Forms, SearchableSelect, useMemo, useState } from "@webpack/common";

import { getCurrentVoice, settings, TIKTOK_VOICES } from "./settings";

// Group TikTok voices by language
function groupBy<T extends object, K extends PropertyKey>(arr: T[], fn: (obj: T) => K) {
    return arr.reduce((acc, obj) => {
        const value = fn(obj);
        acc[value] ??= [];
        acc[value].push(obj);
        return acc;
    }, {} as Record<K, T[]>);
}

interface PickerProps {
    voice: string | undefined;
    voices: typeof TIKTOK_VOICES;
}

function SimplePicker({ voice, voices }: PickerProps) {
    const options = voices.map(v => ({
        label: v.name,
        value: v.id,
        default: v.id === "en_us_001", // Default to English US Female 1
    }));

    return (
        <SearchableSelect
            placeholder="Select a voice"
            maxVisibleItems={5}
            options={options}
            value={options.find(o => o.value === voice)?.value}
            onChange={v => settings.store.customVoice = v}
            closeOnSelect
        />
    );
}

function ComplexPicker({ voice, voices }: PickerProps) {
    const groupedVoices = useMemo(() => groupBy(voices, voice => voice.lang), [voices]);

    const languageNameMapping = useMemo(() => {
        const list = [] as { name: string, friendlyName: string; }[];

        // Create unique list of languages
        const uniqueLangs = [...new Set(voices.map(v => v.lang))];

        for (const lang of uniqueLangs) {
            list.push({
                name: lang,
                friendlyName: lang || "Vocals" // Handle empty lang for vocal voices
            });
        }

        return list;
    }, [voices]);

    const [selectedLanguage, setSelectedLanguage] = useState(() => {
        const currentVoice = getCurrentVoice();
        return currentVoice?.lang ?? languageNameMapping[0]?.name;
    });

    if (languageNameMapping.length === 1) {
        return (
            <SimplePicker
                voice={voice}
                voices={groupedVoices[languageNameMapping[0].name]}
            />
        );
    }

    const voicesForLanguage = groupedVoices[selectedLanguage] || [];

    const languageOptions = languageNameMapping.map(l => ({
        label: l.friendlyName,
        value: l.name
    }));

    return (
        <>
            <Forms.FormTitle>Language</Forms.FormTitle>
            <SearchableSelect
                placeholder="Select a language"
                options={languageOptions}
                value={languageOptions.find(l => l.value === selectedLanguage)?.value}
                onChange={v => setSelectedLanguage(v)}
                maxVisibleItems={5}
                closeOnSelect
            />
            <Forms.FormTitle>Voice</Forms.FormTitle>
            <SimplePicker
                voice={voice}
                voices={voicesForLanguage}
            />
        </>
    );
}

function VoiceSetting() {
    const { customVoice } = settings.use(["customVoice"]);

    if (!TIKTOK_VOICES.length)
        return <Forms.FormText>No voices found.</Forms.FormText>;

    // Group voices by language if there are many
    const Picker = TIKTOK_VOICES.length > 20 ? ComplexPicker : SimplePicker;
    return <Picker voice={customVoice} voices={TIKTOK_VOICES} />;
}

export function VoiceSettingSection() {
    return (
        <section>
            <Forms.FormTitle>Voice</Forms.FormTitle>
            <VoiceSetting />
        </section>
    );
}
