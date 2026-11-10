/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Text } from "@components/Text";
import { openSoundBoardLog } from "@plugins/soundBoardLogger/components/SoundBoardLog";
import { OptionType } from "@utils/types";
import { TextInput, useState } from "@webpack/common";

const settings = definePluginSettings({
    SavedIds: {
        description: "The amount of soundboard ids you want to save at a time (0 lets you save infinite)",
        type: OptionType.COMPONENT,
        component: ({ setValue }) => {
            const value = settings.store.SavedIds ?? 50;
            const [state, setState] = useState(`${value}`);
            const [shouldShowWarning, setShouldShowWarning] = useState(false);
            const [errorMessage, setErrorMessage] = useState<string | null>(null);

            function handleChange(newValue) {
                const changed = Number(newValue);

                if (Number.isNaN(changed) || changed % 1 !== 0 || changed < 0) {
                    let errorMsg = "";
                    errorMsg += Number.isNaN(changed) ? "The value is not a number.\n" : "";
                    errorMsg += (changed % 1 !== 0) ? "The value can't be a decimal number.\n" : "";
                    errorMsg += (changed < 0) ? "The value can't be a negative number.\n" : "";
                    setErrorMessage(errorMsg);
                    return;
                } else {
                    setErrorMessage(null);
                }


                if (changed < value) {
                    setShouldShowWarning(true);
                } else {
                    setShouldShowWarning(false);
                }
                setState(newValue);
                setValue(changed);
            }


            return (
                <section>
                    <Heading>The amount of soundboard ids you want to save at a time (0 lets you save infinite)</Heading>
                    <TextInput
                        type="number"
                        pattern="-?[0-9]+"
                        value={state}
                        onChange={handleChange}
                        placeholder={"Enter a number"}
                    />
                    {shouldShowWarning && <Text style={{ color: "var(--text-danger)" }}>Warning! Setting the number to a lower value will reset the log!</Text>}
                    {errorMessage && <Text style={{ color: "var(--text-danger)" }}>{errorMessage}</Text>}
                </section>
            );
        }

    },
    FileType: {
        description: "the format that you want to save your file",
        type: OptionType.SELECT,
        options: [
            { label: ".ogg", value: ".ogg", default: true },
            { label: ".mp3", value: ".mp3" },
            { label: ".wav", value: ".wav" },
        ],
    },
    OpenLogs: {
        type: OptionType.COMPONENT,
        description: "show the logs",
        component: () =>
            <Button variant="link" size="small" onClick={openSoundBoardLog}>Open Logs</Button>
    }
});

export default settings;
