/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { OpenExternalIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { CommandArgument, CommandContext } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { DraftType, Menu, PermissionsBits, PermissionStore, React, Select, SelectedChannelStore, showToast, TextInput, Toasts, UploadManager, useEffect, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.BiggerFileUpload as PluginNative<typeof import("./native")>;

const UploadStore = findByPropsLazy("getUploads");
const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg", ".3gp", ".ogv"];
const uploadErrorMessage = "**Unable to upload file.** Check the console for more info.\n-# This is likely an issue with your network connection, firewall, or VPN.";

function createCloneableStore(initialState: any) {
    const store = { ...initialState };
    const listeners: (() => void)[] = [];

    function get() {
        return { ...store };
    }

    function set(newState: Partial<typeof store>) {
        Object.assign(store, newState);
        listeners.forEach(listener => listener());
    }

    function subscribe(listener: () => void) {
        listeners.push(listener);
        return () => {
            const index = listeners.indexOf(listener);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        };
    }

    return {
        get,
        set,
        subscribe
    };
}

function SettingsComponent(props: { setValue(v: any): void; }) {
    const [fileUploader, setFileUploader] = useState(settings.store.fileUploader || "GoFile");
    const [customUploaderStore] = useState(() => createCloneableStore({
        name: settings.store.customUploaderName || "",
        requestURL: settings.store.customUploaderRequestURL || "",
        fileFormName: settings.store.customUploaderFileFormName || "",
        responseType: settings.store.customUploaderResponseType || "",
        url: settings.store.customUploaderURL || "",
        thumbnailURL: settings.store.customUploaderThumbnailURL || "",
        headers: (() => {
            const parsedHeaders = JSON.parse(settings.store.customUploaderHeaders || "{}");
            if (Object.keys(parsedHeaders).length === 0) {
                parsedHeaders[""] = "";
            }
            return parsedHeaders;
        })(),
        args: (() => {
            const parsedArgs = JSON.parse(settings.store.customUploaderArgs || "{}");
            if (Object.keys(parsedArgs).length === 0) {
                parsedArgs[""] = "";
            }
            return parsedArgs;
        })(),
    }));

    const fileInputRef = React.useRef<HTMLInputElement>(null);

    useEffect(() => {
        const unsubscribe = customUploaderStore.subscribe(() => {
            const state = customUploaderStore.get();
            updateSetting("customUploaderName", state.name);
            updateSetting("customUploaderRequestURL", state.requestURL);
            updateSetting("customUploaderFileFormName", state.fileFormName);
            updateSetting("customUploaderResponseType", state.responseType);
            updateSetting("customUploaderURL", state.url);
            updateSetting("customUploaderThumbnailURL", state.thumbnailURL);
            updateSetting("customUploaderHeaders", JSON.stringify(state.headers));
            updateSetting("customUploaderArgs", JSON.stringify(state.args));
        });

        return unsubscribe;
    }, []);

    function updateSetting(key: keyof typeof settings.store, value: any) {
        if (key in settings.store) {
            (settings.store as any)[key] = value;
        } else {
            console.error(`Invalid setting key: ${key}`);
        }
    }


    function handleShareXConfigUpload(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e: ProgressEvent<FileReader>) => {
                try {
                    const config = JSON.parse(e.target?.result as string);

                    customUploaderStore.set({
                        name: "",
                        requestURL: "",
                        fileFormName: "",
                        responseType: "Text",
                        url: "",
                        thumbnailURL: "",
                        headers: { "": "" },
                        args: { "": "" }
                    });

                    customUploaderStore.set({
                        name: config.Name || "",
                        requestURL: config.RequestURL || "",
                        fileFormName: config.FileFormName || "",
                        responseType: config.ResponseType || "Text",
                        url: config.URL || "",
                        thumbnailURL: config.ThumbnailURL || "",
                        headers: config.Headers || { "": "" },
                        args: config.Arguments || { "": "" }
                    });

                    updateSetting("customUploaderName", config.Name || "");
                    updateSetting("customUploaderRequestURL", config.RequestURL || "");
                    updateSetting("customUploaderFileFormName", config.FileFormName || "");
                    updateSetting("customUploaderResponseType", config.ResponseType || "Text");
                    updateSetting("customUploaderURL", config.URL || "");
                    updateSetting("customUploaderThumbnailURL", config.ThumbnailURL || "");
                    updateSetting("customUploaderHeaders", JSON.stringify(config.Headers || { "": "" }));
                    updateSetting("customUploaderArgs", JSON.stringify(config.Arguments || { "": "" }));

                    setFileUploader("Custom");
                    updateSetting("fileUploader", "Custom");

                    showToast("ShareX config imported successfully!");
                } catch (error) {
                    console.error("Error parsing ShareX config:", error);
                    showToast("Error importing ShareX config. Check console for details.");
                }
            };
            reader.readAsText(file);

            event.target.value = "";
        }
    }

    const validateCustomUploaderSettings = () => {
        if (fileUploader === "Custom") {
            if (!settings.store.customUploaderRequestURL) {
                showToast("Custom uploader request URL is required.");
                return false;
            }
            if (!settings.store.customUploaderFileFormName) {
                showToast("Custom uploader file form name is required.");
                return false;
            }
            if (!settings.store.customUploaderURL) {
                showToast("Custom uploader URL (JSON path) is required.");
                return false;
            }
        }
        return true;
    };

    const handleFileUploaderChange = (v: string) => {
        if (v === "Custom" && !validateCustomUploaderSettings()) {
            return;
        }
        setFileUploader(v);
        updateSetting("fileUploader", v);
    };

    const handleArgChange = (oldKey: string, newKey: string, value: any) => {
        const state = customUploaderStore.get();
        const newArgs = { ...state.args };

        if (oldKey !== newKey) {
            delete newArgs[oldKey];
        }

        if (value === "" && newKey === "") {
            delete newArgs[oldKey];
        } else {
            newArgs[newKey] = value;
        }

        customUploaderStore.set({ args: newArgs });

        if (Object.values(newArgs).every(v => v !== "") && Object.keys(newArgs).every(k => k !== "")) {
            newArgs[""] = "";
        }

        customUploaderStore.set({ args: newArgs });
    };

    const handleHeaderChange = (oldKey: string, newKey: string, value: string) => {
        const state = customUploaderStore.get();
        const newHeaders = { ...state.headers };

        if (oldKey !== newKey) {
            delete newHeaders[oldKey];
        }

        if (value === "" && newKey === "") {
            delete newHeaders[oldKey];
        } else {
            newHeaders[newKey] = value;
        }

        customUploaderStore.set({ headers: newHeaders });

        if (Object.values(newHeaders).every(v => v !== "") && Object.keys(newHeaders).every(k => k !== "")) {
            newHeaders[""] = "";
        }

        customUploaderStore.set({ headers: newHeaders });
    };

    const triggerFileUpload = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    return (
        <Flex flexDirection="column">
            {/* File Uploader Selection */}
            <section />
            <section title="Upload Limit Bypass">
                <Paragraph>
                    Select the external file uploader service to be used to bypass the upload limit.
                </Paragraph>
                <Select
                    options={[
                        { label: "Custom Uploader", value: "Custom" },
                        { label: "Catbox (Up to 200MB)", value: "Catbox" },
                        { label: "Litterbox (Temporary | Up to 1GB)", value: "Litterbox" },
                        { label: "GoFile (Temporary | Unlimited | No Embeds)", value: "GoFile" },
                        { label: "VikingFile (Temporary | Unlimited | No Embeds)", value: "VikingFile" },
                    ]}
                    placeholder="Select the file uploader service"
                    className={Margins.bottom16}
                    select={handleFileUploaderChange}
                    isSelected={v => v === fileUploader}
                    serialize={v => v}
                />
            </section>

            {/* Auto-Send Settings */}
            <section>
                <FormSwitch
                    title="Auto-Send Uploads To Chat"
                    description="Whether to automatically send the links with the uploaded files to chat instead of just pasting them into the chatbox."
                    value={settings.store.autoSend === "Yes"}
                    onChange={(enabled: boolean) => updateSetting("autoSend", enabled ? "Yes" : "No")}
                    hideBorder={true}
                />
            </section>

            {/* GoFile Settings */}
            {fileUploader === "GoFile" && (
                <>
                    <section title="GoFile Token (optional)">
                        <Paragraph>
                            Insert your personal GoFile account's token to save all uploads to your GoFile account.
                        </Paragraph>
                        <TextInput
                            type="text"
                            value={settings.store.gofileToken || ""}
                            placeholder="Insert GoFile Token"
                            onChange={newValue => updateSetting("gofileToken", newValue)}
                            className={Margins.top16}
                        />
                    </section>
                </>
            )}

            {/* Catbox Settings */}
            {fileUploader === "Catbox" && (
                <>
                    <section title="Catbox User hash (optional)">
                        <Paragraph>
                            Insert your personal Catbox account's hash to save all uploads to your Catbox account.
                        </Paragraph>
                        <TextInput
                            type="text"
                            value={settings.store.catboxUserHash || ""}
                            placeholder="Insert User Hash"
                            onChange={newValue => updateSetting("catboxUserHash", newValue)}
                            className={Margins.top16}
                        />
                    </section>
                </>
            )}

            {/* Litterbox Settings */}
            {fileUploader === "Litterbox" && (
                <>
                    <section title="File Expiration Time">
                        <Paragraph>
                            Select how long it should take for your uploads to expire and get deleted.
                        </Paragraph>
                        <Select
                            options={[
                                { label: "1 hour", value: "1h" },
                                { label: "12 hours", value: "12h" },
                                { label: "24 hours", value: "24h" },
                                { label: "72 hours", value: "72h" },
                            ]}
                            placeholder="Select Duration"
                            className={Margins.top16}
                            select={newValue => updateSetting("litterboxTime", newValue)}
                            isSelected={v => v === settings.store.litterboxTime}
                            serialize={v => v}
                        />
                    </section>
                </>
            )}

            {/* VikingFile Settings */}
            {fileUploader === "VikingFile" && (
                <>
                    <section title="VikingFile User hash (optional)">
                        <Paragraph>
                            Insert your personal VikingFile account's hash to save all uploads to your VikingFile account.
                        </Paragraph>
                        <TextInput
                            type="text"
                            value={settings.store.vikingfileUserHash || ""}
                            placeholder="Insert User Hash"
                            onChange={newValue => updateSetting("vikingfileUserHash", newValue)}
                            className={Margins.top16}
                        />
                    </section>
                </>
            )}

            {/* Custom Uploader Settings */}
            {fileUploader === "Custom" && (
                <>
                    <section title="Custom Uploader Name">
                        <TextInput
                            type="text"
                            value={customUploaderStore.get().name}
                            placeholder="Name"
                            onChange={(newValue: string) => customUploaderStore.set({ name: newValue })}
                            className={Margins.bottom16}
                        />
                    </section>

                    <section title="Request URL">
                        <TextInput
                            type="text"
                            value={customUploaderStore.get().requestURL}
                            placeholder="URL"
                            onChange={(newValue: string) => customUploaderStore.set({ requestURL: newValue })}
                            className={Margins.bottom16}
                        />
                    </section>

                    <section title="File Form Name">
                        <TextInput
                            type="text"
                            value={customUploaderStore.get().fileFormName}
                            placeholder="Name"
                            onChange={(newValue: string) => customUploaderStore.set({ fileFormName: newValue })}
                            className={Margins.bottom16}
                        />
                    </section>

                    <section title="Response type">
                        <Select
                            options={[
                                { label: "Text", value: "Text" },
                                { label: "JSON", value: "JSON" },
                            ]}
                            placeholder="Select Response Type"
                            className={Margins.bottom16}
                            select={(newValue: string) => customUploaderStore.set({ responseType: newValue })}
                            isSelected={(v: string) => v === customUploaderStore.get().responseType}
                            serialize={(v: string) => v}
                        />
                    </section>

                    <section title="URL (JSON path)">
                        <TextInput
                            type="text"
                            value={customUploaderStore.get().url}
                            placeholder="URL"
                            onChange={(newValue: string) => customUploaderStore.set({ url: newValue })}
                            className={Margins.bottom16}
                        />
                    </section>

                    <section title="Thumbnail URL (JSON path)">
                        <TextInput
                            type="text"
                            value={customUploaderStore.get().thumbnailURL}
                            placeholder="Thumbnail URL"
                            onChange={(newValue: string) => customUploaderStore.set({ thumbnailURL: newValue })}
                            className={Margins.bottom16}
                        />
                    </section>

                    <Divider />
                    <Divider />
                    <Heading>Custom Uploader Arguments</Heading>
                    {Object.entries(customUploaderStore.get().args).map(([key, value], index) => (
                        <div key={index}>
                            <TextInput
                                type="text"
                                value={key}
                                placeholder="Argument Key"
                                onChange={(newKey: string) => handleArgChange(key, newKey, value as string)}
                                className={Margins.bottom16}
                            />
                            <TextInput
                                type="text"
                                value={value as string}
                                placeholder="Argument Value"
                                onChange={(newValue: string) => handleArgChange(key, key, newValue)}
                                className={Margins.bottom16}
                            />
                        </div>
                    ))}

                    <Divider />
                    <Heading>Headers</Heading>
                    {Object.entries(customUploaderStore.get().headers).map(([key, value], index) => (
                        <div key={index}>
                            <TextInput
                                type="text"
                                value={key}
                                placeholder="Header Key"
                                onChange={(newKey: string) => handleHeaderChange(key, newKey, value as string)}
                                className={Margins.bottom16}
                            />
                            <TextInput
                                type="text"
                                value={value as string}
                                placeholder="Header Value"
                                onChange={(newValue: string) => handleHeaderChange(key, key, newValue)}
                                className={Margins.bottom16}
                            />
                        </div>
                    ))}

                    <Divider />
                    <Heading>Import ShareX Config</Heading>
                    <Button
                        onClick={triggerFileUpload}
                        variant="primary"
                        size="medium"
                        className={Margins.bottom16}
                    >
                        Import
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".sxcu"
                        style={{ display: "none" }}
                        onChange={handleShareXConfigUpload}
                    />
                </>
            )}
        </Flex>
    );
}

const settings = definePluginSettings({
    fileUploader: {
        type: OptionType.SELECT,
        options: [
            { label: "Custom Uploader", value: "Custom" },
            { label: "Catbox", value: "Catbox", default: true },
            { label: "Litterbox", value: "Litterbox" },
            { label: "GoFile", value: "GoFile" },
        ],
        description: "Select the file uploader service",
        hidden: true
    },
    gofileToken: {
        type: OptionType.STRING,
        default: "",
        description: "GoFile Token (optional)",
        hidden: true
    },
    autoSend: {
        type: OptionType.SELECT,
        options: [
            { label: "Yes", value: "Yes" },
            { label: "No", value: "No", default: true },
        ],
        description: "Auto-Send",
        hidden: true
    },
    catboxUserHash: {
        type: OptionType.STRING,
        default: "",
        description: "User hash for Catbox uploader (optional)",
        hidden: true
    },
    litterboxTime: {
        type: OptionType.SELECT,
        options: [
            { label: "1 hour", value: "1h", default: true },
            { label: "12 hours", value: "12h" },
            { label: "24 hours", value: "24h" },
            { label: "72 hours", value: "72h" },
        ],
        description: "Duration for files on Litterbox before they are deleted",
        hidden: true
    },
    vikingfileUserHash: {
        type: OptionType.STRING,
        default: "",
        description: "User hash for VikingFile uploader (optional)",
        hidden: true
    },
    customUploaderName: {
        type: OptionType.STRING,
        default: "",
        description: "Name of the custom uploader",
        hidden: true
    },
    customUploaderRequestURL: {
        type: OptionType.STRING,
        default: "",
        description: "Request URL for the custom uploader",
        hidden: true
    },
    customUploaderFileFormName: {
        type: OptionType.STRING,
        default: "",
        description: "File form name for the custom uploader",
        hidden: true
    },
    customUploaderResponseType: {
        type: OptionType.SELECT,
        options: [
            { label: "Text", value: "Text", default: true },
            { label: "JSON", value: "JSON" },
        ],
        description: "Response type for the custom uploader",
        hidden: true
    },
    customUploaderURL: {
        type: OptionType.STRING,
        default: "",
        description: "URL (JSON path) for the custom uploader",
        hidden: true
    },
    customUploaderThumbnailURL: {
        type: OptionType.STRING,
        default: "",
        description: "Thumbnail URL (JSON path) for the custom uploader",
        hidden: true
    },
    customUploaderHeaders: {
        type: OptionType.STRING,
        default: JSON.stringify({}),
        description: "Headers for the custom uploader (JSON string)",
        hidden: true
    },
    customUploaderArgs: {
        type: OptionType.STRING,
        default: JSON.stringify({}),
        description: "Arguments for the custom uploader (JSON string)",
        hidden: true
    },
    customSettings: {
        type: OptionType.COMPONENT,
        component: SettingsComponent,
        description: "Configure custom uploader settings",
        hidden: false
    },
}).withPrivateSettings<{
    customUploaderArgs?: Record<string, string>;
    customUploaderHeaders?: Record<string, string>;
}>();

function sendTextToChat(text: string) {
    if (settings.store.autoSend === "No") {
        insertTextIntoChatInputBox(text);
    } else {
        const channelId = SelectedChannelStore.getChannelId();
        sendMessage(channelId, { content: text });
    }
}

async function resolveFile(options: CommandArgument[], ctx: CommandContext): Promise<File | null> {
    for (const opt of options) {
        if (opt.name === "file") {
            const upload = UploadStore.getUpload(ctx.channel.id, opt.name, DraftType.SlashCommand);
            return upload.item.file;
        }
    }
    return null;
}

async function uploadFileToGofile(file: File, channelId: string) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileType = file.type;

        const uploadResult = await Native.uploadFileToGofileNative(
            arrayBuffer,
            fileName,
            fileType
        );

        if (uploadResult?.status === "ok") {
            const { downloadPage } = uploadResult.data;
            setTimeout(() => sendTextToChat(`${downloadPage} `), 10);
            showToast("File Successfully Uploaded!", Toasts.Type.SUCCESS);
        } else {
            console.error("Upload failed:", uploadResult);
            sendBotMessage(channelId, {
                content: uploadErrorMessage
            });
            showToast("File Upload Failed", Toasts.Type.FAILURE);
        }

        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    } catch (error) {
        console.error("Upload error:", error);
        sendBotMessage(channelId, {
            content: uploadErrorMessage
        });
        showToast("File Upload Failed", Toasts.Type.FAILURE);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}


async function uploadFileToCatbox(file: File, channelId: string, temporary: boolean) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileType = file.type;

        let url = "";
        const extraField: { userhash?: string; time?: string; } = {};

        if (!temporary) {
            url = "https://catbox.moe/user/api.php";
            extraField.userhash = settings.store.catboxUserHash;
        } else {
            url = "https://litterbox.catbox.moe/resources/internals/api.php";
            extraField.time = settings.store.litterboxTime;
        }

        const uploadResult = await Native.uploadFileToCatboxNative(
            url,
            arrayBuffer,
            fileName,
            fileType,
            extraField
        );

        if (uploadResult.startsWith("https://") || uploadResult.startsWith("http://")) {

            let finalUrl = uploadResult;

            if (videoExtensions.some(ext => finalUrl.endsWith(ext))) {
                finalUrl = await Native.getEmbeddrLinkNative(finalUrl);
            }

            setTimeout(() => sendTextToChat(finalUrl), 10);
            showToast("File Successfully Uploaded!", Toasts.Type.SUCCESS);
        } else {
            console.error("Upload failed, likely due to network or firewall:", uploadResult);
            sendBotMessage(channelId, {
                content: uploadErrorMessage
            });
            showToast("File Upload Failed", Toasts.Type.FAILURE);
        }

        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    } catch (error) {
        console.error("Upload error:", error);
        sendBotMessage(channelId, {
            content: uploadErrorMessage
        });
        showToast("File Upload Failed", Toasts.Type.FAILURE);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}


async function uploadFileToVikingFile(file: File, channelId: string) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const userHash = settings.store.vikingfileUserHash;


        const uploadResult = await Native.uploadFileToVikingFileNative(
            arrayBuffer,
            fileName,
            userHash
        );

        if (uploadResult?.url) {
            setTimeout(() => sendTextToChat(`${uploadResult.url} `), 10);
            showToast("File Successfully Uploaded!", Toasts.Type.SUCCESS);
        } else {
            console.error("Upload failed:", uploadResult);
            sendBotMessage(channelId, {
                content:
                    uploadErrorMessage
            });
            showToast("File Upload Failed", Toasts.Type.FAILURE);
        }

        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    } catch (error) {
        console.error("Upload error:", error);
        sendBotMessage(channelId, {
            content:
                uploadErrorMessage
        });
        showToast("File Upload Failed", Toasts.Type.FAILURE);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}


async function uploadFileCustom(file: File, channelId: string) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileType = file.type;

        const fileFormName = settings.store.customUploaderFileFormName || "file[]";
        const customArgs = JSON.parse(settings.store.customUploaderArgs || "{}");
        const customHeaders = JSON.parse(settings.store.customUploaderHeaders || "{}");
        const responseType = settings.store.customUploaderResponseType;
        const urlPath = settings.store.customUploaderURL.split(".");

        const finalUrl = await Native.uploadFileCustomNative(settings.store.customUploaderRequestURL, arrayBuffer, fileName, fileType, fileFormName, customArgs, customHeaders, responseType, urlPath);

        if (finalUrl.startsWith("https://") || finalUrl.startsWith("http://")) {
            const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg", ".3gp", ".ogv"];
            let finalUrlModified = finalUrl;

            if (videoExtensions.some(ext => finalUrlModified.endsWith(ext))) {
                finalUrlModified = await Native.getEmbeddrLinkNative(finalUrlModified);
            }

            setTimeout(() => sendTextToChat(`${finalUrlModified} `), 10);
            showToast("File Successfully Uploaded!", Toasts.Type.SUCCESS);
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
        } else {
            console.error("Unable to upload file. This is likely an issue with your network connection, firewall, or VPN. Invalid URL returned");
            sendBotMessage(channelId, { content: "**Unable to upload file.** Check the console for more info. \n-# This is likely an issue with your network connection, firewall, or VPN." });
            showToast("File Upload Failed", Toasts.Type.FAILURE);
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
        }
    } catch (error) {
        console.error("Unable to upload file. This is likely an issue with your network connection, firewall, or VPN.", error);
        sendBotMessage(channelId, { content: `Unable to upload file. This is likely an issue with your network connection, firewall, or VPN. ${error}. Check the console for more info. \n-# This is likely an issue with your network connection, firewall, or VPN.` });
        showToast("File Upload Failed", Toasts.Type.FAILURE);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}

async function uploadFile(file: File, channelId: string) {
    const uploader = settings.store.fileUploader;
    switch (uploader) {
        case "GoFile":
            await uploadFileToGofile(file, channelId);
            break;
        case "Catbox":
            await uploadFileToCatbox(file, channelId, false);
            break;
        case "Litterbox":
            await uploadFileToCatbox(file, channelId, true);
            break;
        case "VikingFile":
            await uploadFileToVikingFile(file, channelId);
            break;
        case "Custom":
            await uploadFileCustom(file, channelId);
            break;
        default:
            console.error("Unknown uploader:", uploader);
            sendBotMessage(channelId, { content: "Error: Unknown uploader selected." });
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}

function triggerFileUpload() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.display = "none";

    fileInput.onchange = async event => {
        const target = event.target as HTMLInputElement;
        if (target && target.files && target.files.length > 0) {
            const file = target.files[0];
            if (file) {
                const channelId = SelectedChannelStore.getChannelId();
                showToast("Uploading file... Please wait.");
                await uploadFile(file, channelId);
            } else {
                showToast("No file selected");
            }
        }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

const ctxMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (props.channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, props.channel)) return;

    children.splice(1, 0,
        <Menu.MenuItem
            id="upload-big-file"
            iconLeft={OpenExternalIcon}
            leadingAccessory={{
                type: "icon",
                icon: OpenExternalIcon
            }}
            label="Upload a Big File"
            action={triggerFileUpload}
        />
    );
};

export default definePlugin({
    name: "BiggerFileUpload",
    description: "Bypass Discord's upload limit by uploading files using the 'Upload a Big File' button or /fileupload and they'll get uploaded as links into chat via file uploaders.",
    authors: [Devs.ScattrdBlade],
    settings,
    dependencies: ["CommandsAPI"],
    contextMenus: {
        "channel-attach": ctxMenuPatch,
    },
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fileupload",
            description: "Upload a file",
            options: [
                {
                    name: "file",
                    description: "The file to upload",
                    type: ApplicationCommandOptionType.ATTACHMENT,
                    required: true,
                },
            ],
            execute: async (opts, cmdCtx) => {
                const file = await resolveFile(opts, cmdCtx);
                if (file) {
                    showToast("Uploading file... Please wait.");
                    await uploadFile(file, cmdCtx.channel.id);
                } else {
                    sendBotMessage(cmdCtx.channel.id, { content: "No file specified!" });
                    UploadManager.clearAll(cmdCtx.channel.id, DraftType.SlashCommand);
                }
            },
        },
    ],
});
