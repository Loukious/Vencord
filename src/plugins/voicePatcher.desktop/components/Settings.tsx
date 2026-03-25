/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { CodeBlock, InlineCode } from "@components/CodeBlock";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { applyAndLogPatches, Native, settings } from "@plugins/voicePatcher.desktop/index";
import { React, showToast, TextArea, TextInput, Toasts } from "@webpack/common";

export default function VoicePatcherSettings() {
    const [originalPatches, setOriginalPatches] = React.useState<{ name: string, content: string; }[]>([]);
    const [disabledPatches, setDisabledPatches] = React.useState<string[]>(() => {
        try {
            return JSON.parse(settings.store.disabledPatches || "[]");
        } catch {
            return [];
        }
    });
    const [customPatches, setCustomPatches] = React.useState<{ name: string, content: string, enabled: boolean; }[]>(() => {
        try {
            return JSON.parse(settings.store.customPatches || "[]");
        } catch {
            return [];
        }
    });

    const [newPatchName, setNewPatchName] = React.useState("");
    const [newPatchContent, setNewPatchContent] = React.useState("");

    React.useEffect(() => {
        Native.getOriginalIniPatches().then(setOriginalPatches).catch(console.error);
    }, []);

    function toggleDisabled(name: string, isChecked: boolean) {
        const next = isChecked
            ? disabledPatches.filter(p => p !== name)
            : [...disabledPatches, name];

        setDisabledPatches(next);
        settings.store.disabledPatches = JSON.stringify(next);
    }

    function toggleCustom(index: number, isChecked: boolean) {
        const next = [...customPatches];
        next[index].enabled = isChecked;
        setCustomPatches(next);
        settings.store.customPatches = JSON.stringify(next);
    }

    function removeCustomPatch(index: number) {
        const next = [...customPatches];
        next.splice(index, 1);
        setCustomPatches(next);
        settings.store.customPatches = JSON.stringify(next);
    }

    function addCustomPatch() {
        if (!newPatchName || !newPatchContent) return;
        const next = [...customPatches, { name: newPatchName, content: newPatchContent, enabled: true }];
        setCustomPatches(next);
        settings.store.customPatches = JSON.stringify(next);
        setNewPatchName("");
        setNewPatchContent("");
    }

    return (
        <div>
            <Card className={Margins.bottom20}>
                <Heading tag="h3">Original Patches (INI)</Heading>
                <div style={{ paddingTop: "10px" }}>
                    {originalPatches.length === 0 && <span style={{ color: "var(--text-muted)" }}>Loading original patches...</span>}
                    {originalPatches.map(patch => (
                        <Flex key={patch.name} style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "0.8em" }}>
                            <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: "1em" }}>
                                <Heading style={{ margin: 0, marginBottom: "0.3em" }} tag="h5">{patch.name}</Heading>
                                <span style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "pre-wrap", fontFamily: "var(--font-code)", wordBreak: "break-all" }}>
                                    {patch.content}
                                </span>
                            </div>
                            <Switch
                                checked={!disabledPatches.includes(patch.name)}
                                onChange={checked => toggleDisabled(patch.name, checked)}
                            />
                        </Flex>
                    ))}
                </div>
            </Card>

            <Card className={Margins.bottom20}>
                <Heading tag="h3">Custom Patches</Heading>
                <div style={{ paddingTop: "10px" }}>
                    {customPatches.map((patch, i) => (
                        <div key={i} style={{ marginBottom: "1em", padding: "1em", backgroundColor: "var(--background-secondary-alt)", border: "1px solid var(--background-modifier-accent)", borderRadius: "8px" }}>
                            <Flex style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "0.5em" }}>
                                <Heading style={{ margin: 0 }} tag="h5">{patch.name}</Heading>
                                <Flex style={{ gap: "1em", alignItems: "center" }}>
                                    <Button
                                        size="small"
                                        color="red"
                                        onClick={() => removeCustomPatch(i)}>
                                        Delete
                                    </Button>
                                    <Switch
                                        checked={patch.enabled}
                                        onChange={checked => toggleCustom(i, checked)}
                                    />
                                </Flex>
                            </Flex>
                            <div style={{ marginTop: "0.5em" }}>
                                <CodeBlock content={patch.content.trim()} lang="ini" />
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            <Card className={Margins.bottom20}>
                <Heading tag="h5" style={{ marginBottom: "0.5em" }}>Add Custom Patch</Heading>
                <Paragraph style={{ marginBottom: "1em", fontSize: "0.9em" }}>
                    Provide an INI section block to be securely embedded into the natively executed patcher config list.
                    New patches <strong>must</strong> include a top-level section header mapping their name for the hooks resolver!
                    <br /><br />
                    Example format:
                    <br /><InlineCode>[My Payload]</InlineCode>
                    <br /><InlineCode>pattern = AA BB CC DD</InlineCode>
                    <br /><InlineCode>sig_offset = AA BB CC DD</InlineCode>
                    <br /><InlineCode>expected = 4</InlineCode>
                    <br /><InlineCode>patch = FF FF</InlineCode>
                </Paragraph>

                <Flex style={{ flexDirection: "column", gap: "1em" }}>
                    <TextInput
                        value={newPatchName}
                        onChange={setNewPatchName}
                        placeholder="Patch Name (e.g. My Custom Patch)"
                    />
                    <TextArea
                        value={newPatchContent}
                        onChange={setNewPatchContent}
                        placeholder={"[My Patch]\nSig = FF FF\nPatch = 00 00"}
                        rows={6}
                    />
                    <div style={{ alignSelf: "flex-end" }}>
                        <Button onClick={addCustomPatch} disabled={!newPatchName || !newPatchContent}>
                            Add Patch
                        </Button>
                    </div>
                </Flex>
            </Card>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <Button
                    onClick={() => {
                        applyAndLogPatches(
                            settings.store.disabledPatches || "[]",
                            settings.store.customPatches || "[]"
                        ).then(result => {
                            if (result.error) {
                                showToast("Failed: " + result.error, Toasts.Type.FAILURE);
                            } else {
                                showToast("Patches applied! New memory hooks dynamically active.", Toasts.Type.SUCCESS);
                            }
                        }).catch(e => {
                            showToast("Exception: " + String(e), Toasts.Type.FAILURE);
                        });
                    }}
                >
                    Apply Patches Now
                </Button>

                <Paragraph style={{ fontWeight: 600, fontSize: "0.95em", textAlign: "center", maxWidth: "600px" }}>
                    Note: Newly enabled patches apply instantly. However, disabling patches requires
                    restarting Discord fully to clear previously written runtime memory hooks!
                </Paragraph>
            </div>
        </div>
    );
}
