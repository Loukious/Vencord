/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands";
import { createUploadProgressCard } from "@plugins/biggerFileUpload/progressCard";
import { settings, UPLOADER_OPTIONS } from "@plugins/biggerFileUpload/settings";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import { PluginNative } from "@utils/types";
import { DraftType, SelectedChannelStore, showToast, Toasts, UploadManager } from "@webpack/common";

const Native = VencordNative.pluginHelpers.BiggerFileUpload as PluginNative<typeof import("@plugins/biggerFileUpload/native")>;

const videoExtensions = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg", ".3gp", ".ogv"];

// All upload failures funnel through here so the chat message carries the
// error the server actually returned — HTTP status, the uploader's error
// code, or an excerpt of the body — instead of a generic "check the console"
function reportUploadError(channelId: string, uploader: string, reason: unknown) {
    const detail = typeof reason === "string"
        ? reason
        : reason instanceof Error
            ? reason.message
            : JSON.stringify(reason);

    // The user pressed Cancel — the abort error arrives here like any other
    // failure, but it isn't one; skip the chat message and the failure toast
    if (/upload cancelled/i.test(detail)) {
        showToast("Upload cancelled", Toasts.Type.MESSAGE);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
        return;
    }

    const excerpt = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
    console.error(`[BiggerFileUpload] ${uploader} upload failed:`, reason);

    // A 5xx or an error page means the service itself is having trouble —
    // nothing the user's connection or settings can fix
    const serviceHint = /HTTP 5\d\d|internal server error|bad gateway|service unavailable|service error page/i.test(excerpt)
        ? "\n-# This is a server-side issue with the upload service — try again later or switch to a different uploader in the plugin settings."
        : "";

    // Only blame the network when the error actually looks like one
    const networkHint = /fetch|network|timeout|timed out|econn|enotfound|err_/i.test(excerpt)
        ? "\n-# This is likely an issue with your network connection, firewall, or VPN."
        : "";

    sendBotMessage(channelId, {
        content: `**Unable to upload file to ${uploader}.**\n-# ${excerpt}${serviceHint}${networkHint}`
    });
    showToast("File Upload Failed", Toasts.Type.FAILURE);
}

function sendTextToChat(text: string) {
    if (settings.store.autoSend === "No") {
        insertTextIntoChatInputBox(text);
    } else {
        const channelId = SelectedChannelStore.getChannelId();
        sendMessage(channelId, { content: text });
    }
}

async function uploadFileToGofile(file: File, channelId: string) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const fileType = file.type;

        const uploadResult = await Native.uploadFileToGofileNative(
            arrayBuffer,
            fileName,
            fileType,
            settings.store.gofileToken || undefined
        );

        if (uploadResult?.status === "ok") {
            const { downloadPage } = uploadResult.data;
            setTimeout(() => sendTextToChat(`${downloadPage} `), 10);
            showToast("File Successfully Uploaded!", Toasts.Type.SUCCESS);
        } else {
            const message = uploadResult?.data?.message ?? uploadResult?.data?.error ?? uploadResult?.error ?? null;
            reportUploadError(channelId, "GoFile", message ? `${uploadResult?.status ?? "error"}: ${message}` : uploadResult);
        }

        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    } catch (error) {
        reportUploadError(channelId, "GoFile", error);
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
            // Catbox reports failures as plain text ("You are banned...", etc.)
            reportUploadError(channelId, temporary ? "Litterbox" : "Catbox", uploadResult);
        }

        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    } catch (error) {
        reportUploadError(channelId, temporary ? "Litterbox" : "Catbox", error);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}


async function uploadFileToFileDitch(file: File, channelId: string) {
    try {
        const arrayBuffer = await file.arrayBuffer();

        const uploadResult = await Native.uploadFileToFileDitchNative(
            arrayBuffer,
            file.name,
            file.type
        );

        if (uploadResult?.success && uploadResult.url) {
            let finalUrl: string = uploadResult.url;

            if (videoExtensions.some(ext => finalUrl.endsWith(ext))) {
                finalUrl = await Native.getEmbeddrLinkNative(finalUrl);
            }

            setTimeout(() => sendTextToChat(`${finalUrl} `), 10);
            showToast("File Successfully Uploaded!", Toasts.Type.SUCCESS);
        } else {
            reportUploadError(channelId, "FileDitch", uploadResult?.error ?? uploadResult);
        }

        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    } catch (error) {
        reportUploadError(channelId, "FileDitch", error);
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
            let finalUrlModified = finalUrl;

            if (videoExtensions.some(ext => finalUrlModified.endsWith(ext))) {
                finalUrlModified = await Native.getEmbeddrLinkNative(finalUrlModified);
            }

            setTimeout(() => sendTextToChat(`${finalUrlModified} `), 10);
            showToast("File Successfully Uploaded!", Toasts.Type.SUCCESS);
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
        } else {
            reportUploadError(channelId, "Custom", finalUrl ? `Uploader did not return a URL (got: ${finalUrl.slice(0, 200)})` : "Uploader did not return a URL");
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
        }
    } catch (error) {
        reportUploadError(channelId, "Custom", error);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}

// Entry point for both the context-menu flow and /fileupload: picks the
// configured uploader and shows the progress card while it runs
export async function uploadFile(file: File, channelId: string) {
    const uploader = settings.store.fileUploader;
    if (!UPLOADER_OPTIONS.some(option => option.value === uploader)) {
        console.error("Unknown uploader:", uploader);
        sendBotMessage(channelId, { content: "Error: Unknown uploader selected." });
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
        return;
    }

    const progressCard = createUploadProgressCard(uploader, file.name, file.size, {
        onCancel: () => Native.cancelUploadNative()
    });
    const progressPoll = setInterval(() => {
        Native.getUploadProgressNative().then(progress => {
            if (progress) progressCard.update(progress.loaded, progress.total);
        });
    }, 500);

    try {
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
            case "FileDitch":
                await uploadFileToFileDitch(file, channelId);
                break;
            case "Custom":
                await uploadFileCustom(file, channelId);
                break;
        }
    } finally {
        clearInterval(progressPoll);
        progressCard.close();
    }
}
