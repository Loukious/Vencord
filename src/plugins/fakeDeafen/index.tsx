/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { addSettingsPanelButton, removeSettingsPanelButton } from "@plugins/philsPluginLibrary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";


export let fakeD = false;

const Button = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

function mute() {
    (document.querySelector('[aria-label="Mute"]') as HTMLElement).click();
}

function deafen() {
    (document.querySelector('[aria-label="Deafen"]') as HTMLElement).click();
}

function makeDeafenIcon(useFakeState: boolean) {
    return function DeafenIconComponent() {
        return (
            <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                {/* Ear Icon Paths */}
                <path
                    d="M5.274 5.876c0.396-0.89 0.744-1.934 1.611-2.476 4.086-2.554 8.316 1.441 7.695 5.786-0.359 2.515-3.004 3.861-4.056 5.965-0.902 1.804-4.457 3.494-4.742 0.925"
                    stroke={useFakeState ? "var(--status-danger)" : "currentColor"}
                    strokeOpacity={0.9}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M11.478 11.931c2.111-2.239 1.579-7.495-1.909-7.337-2.625 0.119-2.012 3.64-1.402 4.861"
                    stroke={useFakeState ? "var(--status-danger)" : "currentColor"}
                    strokeOpacity={0.9}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M7.636 7.755c2.796-0.194 3.747 2.749 1.933 4.563-0.472 0.472-1.386-0.214-1.933 0.06-0.547 0.274-0.957 1.136-1.497 0.507"
                    stroke={useFakeState ? "var(--status-danger)" : "currentColor"}
                    strokeOpacity={0.9}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Strike-through (only shown in fake state) */}
                {useFakeState && (
                    <path
                        d="M19 1L1 19"
                        stroke="var(--status-danger)"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                    />
                )}
            </svg>
        );
    };
}

function updateSettingsPanelButton() {
    const loc = settings.store.buttonLocation;
    if (loc === "settingsPanel" || loc === "both") {
        removeSettingsPanelButton("faked");
        addSettingsPanelButton({
            name: "faked",
            icon: makeDeafenIcon(fakeD),
            tooltipText: "Fake Deafen",
            onClick: toggleFakeDeafen
        });
    }
}

function performFakeDeafen() {
    fakeD = !fakeD;
    console.log("[FakeDeafen] Toggle state:", fakeD ? "ON" : "OFF");

    deafen();
    setTimeout(deafen, 250);

    if (settings.store.muteUponFakeDeafen) {
        setTimeout(mute, 300);
    }

    updateSettingsPanelButton();
}

function toggleFakeDeafen() {
    performFakeDeafen();
}

function fakeDeafenToggleButton(props: { nameplate?: any; }) {
    const loc = settings.store.buttonLocation;
    if (loc !== "voicePanel" && loc !== "both") return null;

    return (
        <Button
            tooltipText="Fake Deafen"
            icon={makeDeafenIcon(fakeD)}
            role="switch"
            aria-checked={!fakeD}
            plated={props?.nameplate != null}
            onClick={performFakeDeafen}
        />
    );
}

let keydownListener: ((e: KeyboardEvent) => void) | null = null;

function parseKeybind(keybind: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string; } {
    const parts = keybind.toLowerCase().split("+");
    return {
        ctrl: parts.includes("ctrl") || parts.includes("control"),
        shift: parts.includes("shift"),
        alt: parts.includes("alt"),
        key: parts[parts.length - 1]
    };
}

function setupKeybindListener() {
    if (keydownListener) {
        document.removeEventListener("keydown", keydownListener);
    }

    keydownListener = (e: KeyboardEvent) => {
        if (!settings.store.enableHotkey) return;

        const keybindValue = settings.store.useCustomKeybind && settings.store.customKeybind
            ? settings.store.customKeybind
            : settings.store.keybind || "f9";

        const keybind = parseKeybind(keybindValue);

        const ctrlMatch = keybind.ctrl === (e.ctrlKey || e.metaKey);
        const shiftMatch = keybind.shift === e.shiftKey;
        const altMatch = keybind.alt === e.altKey;
        const keyMatch = e.key.toLowerCase() === keybind.key.toLowerCase();

        if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
            e.preventDefault();
            toggleFakeDeafen();
        }
    };

    document.addEventListener("keydown", keydownListener);
}

const settings = definePluginSettings({
    buttonLocation: {
        type: OptionType.SELECT,
        description: "Where to show the Fake Deafen button",
        options: [
            { label: "Above your avatar", value: "settingsPanel", default: true },
            { label: "Beside your avatar", value: "voicePanel", default: false },
            { label: "Both", value: "both", default: false },
            { label: "None", value: "none", default: false }
        ],
        onChange: (value: string) => {
            if (value === "settingsPanel" || value === "both") {
                addSettingsPanelButton({
                    name: "faked",
                    icon: makeDeafenIcon(fakeD),
                    tooltipText: "Fake Deafen",
                    onClick: toggleFakeDeafen
                });
            } else {
                removeSettingsPanelButton("faked");
            }
        }
    },
    enableHotkey: {
        type: OptionType.BOOLEAN,
        description: "Enable keyboard shortcut",
        default: false
    },
    keybind: {
        type: OptionType.SELECT,
        description: "",
        options: [
            { label: "F1", value: "f1", default: false },
            { label: "F2", value: "f2", default: false },
            { label: "F3", value: "f3", default: false },
            { label: "F4", value: "f4", default: false },
            { label: "F5", value: "f5", default: false },
            { label: "F6", value: "f6", default: false },
            { label: "F7", value: "f7", default: false },
            { label: "F8", value: "f8", default: false },
            { label: "F9", value: "f9", default: true },
            { label: "F10", value: "f10", default: false },
            { label: "F11", value: "f11", default: false },
            { label: "F12", value: "f12", default: false },
            { label: "Ctrl+D", value: "ctrl+d", default: false },
            { label: "Ctrl+Shift+D", value: "ctrl+shift+d", default: false },
            { label: "Alt+D", value: "alt+d", default: false },
            { label: "Alt+F", value: "alt+f", default: false },
            { label: "Ctrl+Alt+D", value: "ctrl+alt+d", default: false },
            { label: "Shift+F9", value: "shift+f9", default: false },
            { label: "Shift+F10", value: "shift+f10", default: false },
            { label: "Shift+F11", value: "shift+f11", default: false },
            { label: "Shift+F12", value: "shift+f12", default: false }
        ]
    },
    muteUponFakeDeafen: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false
    },
    mute: {
        type: OptionType.BOOLEAN,
        description: "",
        default: true
    },
    deafen: {
        type: OptionType.BOOLEAN,
        description: "",
        default: true
    },
    cam: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false
    },
    useCustomKeybind: {
        type: OptionType.BOOLEAN,
        description: "",
        default: false,
        onChange: () => {
            setupKeybindListener();
        }
    },
    customKeybind: {
        type: OptionType.STRING,
        description: "",
        default: "",
        disabled: () => !settings.store.useCustomKeybind,
        onChange: () => {
            setupKeybindListener();
        }
    }
});

export default definePlugin({
    name: "FakeDeafen",
    description: "You're deafened but you're not",
    dependencies: ["PhilsPluginLibrary"],
    authors: [Devs.desu],

    patches: [
        {
            find: "}voiceStateUpdate(",
            replacement: {
                match: /self_mute:([^,]+),self_deaf:([^,]+),self_video:([^,]+)/,
                replace: "self_mute:$self.toggle($1, 'mute'),self_deaf:$self.toggle($2, 'deaf'),self_video:$self.toggle($3, 'video')"
            }
        },
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /speaking:.{0,100}style:.,children:\[/,
                replace: "$&$self.fakeDeafenToggleButton(arguments[0]),"
            }
        }
    ],

    settings,
    toggle: (au: any, what: string) => {
        if (fakeD === false)
            return au;
        else
            switch (what) {
                case "mute": return settings.store.mute;
                case "deaf": return settings.store.deafen;
                case "video": return settings.store.cam;
            }
    },
    fakeDeafenToggleButton: ErrorBoundary.wrap(fakeDeafenToggleButton, { noop: true }),

    start() {
        setupKeybindListener();
        const loc = settings.store.buttonLocation;
        if (loc === "settingsPanel" || loc === "both") {
            addSettingsPanelButton({
                name: "faked",
                icon: makeDeafenIcon(fakeD),
                tooltipText: "Fake Deafen",
                onClick: toggleFakeDeafen
            });
        }
    },

    stop() {
        if (keydownListener) {
            document.removeEventListener("keydown", keydownListener);
            keydownListener = null;
        }
        removeSettingsPanelButton("faked");
    },

});
