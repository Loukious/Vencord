/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createTransferProgressCard, formatBytes, TransferProgressCard } from "@plugins/dashbeam.desktop/progressCard";
import wasmInit, { cancel_receive, fetch_ticket_metadata, receive_file, send_file, set_event_callback, stop_sharing } from "@plugins/dashbeam.desktop/wasm/wasm_bridge.js";
import { sendMessage } from "@utils/discord";
import { PluginNative } from "@utils/types";
import { showToast, Toasts, UserStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.DashBeam as PluginNative<typeof import("@plugins/dashbeam.desktop/native")>;

export const RECEIVE_LINK_BASE = "https://app.dashbeam.net/receive";

// Non-global on purpose: a global regex's exec() would carry lastIndex state
// across the per-message accessory render checks
export const DASHBEAM_TICKET_REGEX = /https?:\/\/app\.dashbeam\.net\/receive\?ticket=([\w.-]+)/;

export interface FileMetadata {
    file_name: string;
    item_count: number;
    size: number;
    thumbnail?: string;
    mime_type?: string;
    items?: { file_name: string; size: number; thumbnail?: string; mime_type?: string; }[];
}

export interface ActiveShare {
    ticket: string;
    fileName: string;
    size: number;
}

// The wasm bridge supports exactly one share session and one event callback —
// all state here is module-level singletons by necessity
export let activeShare: ActiveShare | null = null;

// Metadata for shares this client sent, so the sender's own embed card never
// needs a network round trip (and keeps working after the session ends)
export const lastSentShares = new Map<string, FileMetadata>();

const metadataCache = new Map<string, FileMetadata | null>();
const metadataInflight = new Map<string, Promise<FileMetadata | null>>();
export const dismissedTickets = new Set<string>();

// Progress-card handles. The wasm emits events without any ticket or
// correlation id, and its single-session model means at most one outbound and
// one inbound transfer exist at a time — two slots cover reality
let outboundCard: TransferProgressCard | null = null;
let inboundCard: TransferProgressCard | null = null;// Metadata is sender-asserted and can lie about size. Once real progress
// events arrive we know the true total — flag a mismatch so the receiver
// isn't tricked into pulling gigabytes by a "2 MB" claim
let claimedSizeForInbound: number | null = null;
let sizeMismatchWarned = false;

export function setClaimedSizeForInbound(size: number | null) {
    claimedSizeForInbound = size;
    sizeMismatchWarned = false;
}

// The embed's claimed size vs the true total from the wire. Only warn for
// meaningfully larger transfers — tiny skew can come from the engine counting
// collection overhead differently, and the point is catching bait-and-switch
function checkClaimedSizeMismatch(actualTotal: number) {
    if (claimedSizeForInbound == null || sizeMismatchWarned || actualTotal <= 0) return;
    if (actualTotal > claimedSizeForInbound * 1.25 + 65536) {
        sizeMismatchWarned = true;
        showToast(`File is actually ${formatBytes(actualTotal)} — the claimed size was ${formatBytes(claimedSizeForInbound)}. Cancel if this wasn't expected.`, Toasts.Type.FAILURE);
    }
}

type EventListener = (eventName: string, payload?: string) => void;
const listeners = new Set<EventListener>();

export function subscribe(listener: EventListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Routes wasm events to the progress cards and any subscribed React cards.
// Payloads: progress events are "bytes:total:speed_bps" (speed in
// millibytes/sec), transfer-completed is JSON {durationMs, bytes, totalBytes}
function routeEvent(eventName: string, payload?: string) {
    for (const listener of listeners) listener(eventName, payload);

    const progressMatch = payload?.match(/^(\d+):(\d+):(\d+)$/);

    switch (eventName) {
        case "transfer-progress":
            if (outboundCard && progressMatch) {
                let loaded = Number(progressMatch[1]);
                // The engine's bytes counter is cumulative across receiver
                // attempts (cancel + re-accept), and its total multiplies by
                // lingering active requests — rebase both so a re-transfer
                // shows the true file size restarting from 0%
                if (outboundLoadedBaseline == null) outboundLoadedBaseline = loaded;
                loaded -= outboundLoadedBaseline;
                const total = activeShare?.size ?? Number(progressMatch[2]);
                outboundCard.update(loaded, total);
            }
            break;
        case "receive-progress":
            if (inboundCard && progressMatch) {
                inboundCard.update(Number(progressMatch[1]), Number(progressMatch[2]));
                checkClaimedSizeMismatch(Number(progressMatch[2]));
            }
            break;
        case "transfer-completed":
            outboundCard?.close();
            outboundCard = null;
            showToast("DashBeam transfer completed", Toasts.Type.SUCCESS);
            break;
        case "transfer-failed":
            outboundCard?.close();
            outboundCard = null;
            showToast("DashBeam transfer failed", Toasts.Type.FAILURE);
            break;
        case "receive-completed":
            // receiveFile's own resolution closes the card — this is just a
            // belt-and-braces for out-of-band completion events
            inboundCard?.close();
            inboundCard = null;
            break;
    }
}

let initPromise: Promise<void> | null = null;

// Loads the wasm bridge from bytes provided by the main process (which reads
// it from disk — a downloaded release or the source tree). Passing bytes to
// init avoids any fetch, so loading never depends on the page CSP
export function ensureWasm() {
    initPromise ??= (async () => {
        const { bytes } = await Native.getWasmBytesNative();
        await wasmInit(new Uint8Array(bytes));
        set_event_callback(routeEvent);
    })().catch(error => {
        initPromise = null;
        throw error;
    });
    return initPromise;
}

// Sender flow: share the file and post the link. Blocked while another share
// is active — the wasm bridge has one session slot and a second send_file
// would silently kill the first ticket
export async function shareFile(file: File, channelId: string) {
    if (activeShare) {
        showToast(`Already sharing "${activeShare.fileName}" — stop it first (Stop button on its card)`, Toasts.Type.FAILURE);
        return;
    }

    try {
        showToast("Starting DashBeam share…", Toasts.Type.MESSAGE);
        await ensureWasm();

        const bytes = new Uint8Array(await file.arrayBuffer());
        const metadata: FileMetadata = {
            file_name: file.name,
            item_count: 1,
            size: file.size,
            mime_type: file.type || undefined
        };

        const result = await send_file(file.name, bytes, JSON.stringify(metadata));
        activeShare = { ticket: result.ticket, fileName: file.name, size: Number(result.size) };
        lastSentShares.set(result.ticket, metadata);

        // Angle brackets suppress Discord's link unfurl for everyone (plugin
        // users and browser users alike) — the embed card replaces it
        const link = `<${RECEIVE_LINK_BASE}?ticket=${encodeURIComponent(result.ticket)}>`;
        await sendMessage(channelId, { content: link });
        showToast(`Sharing "${file.name}" — link sent`, Toasts.Type.SUCCESS);
    } catch (error) {
        console.error("[DashBeam] send failed:", error);
        showToast(`DashBeam send failed: ${error instanceof Error ? error.message : String(error)}`, Toasts.Type.FAILURE);
    }
}

// Receiver flow: download the ticket's files. The progress card is driven by
// receive-progress events through routeEvent. Returns null on failure or
// CANCELLATION — the caller distinguishes them via the result kind
export type AcceptResult =
    | { kind: "success"; files: string[]; bytesList: Uint8Array[]; }
    | { kind: "failed"; }
    | { kind: "cancelled"; };

export async function acceptTicket(ticket: string): Promise<AcceptResult> {
    try {
        await ensureWasm();

        // Progress starts flowing only once the download begins, so the card
        // is created up front with the eventual total. Its Cancel button
        // aborts the in-flight wasm download task
        inboundCard?.close();
        inboundCard = createTransferProgressCard("Receiving", ticket.slice(0, 12) + "…", 0, {
            cancelLabel: "Cancel download",
            onCancel: () => cancel_receive()
        });

        const result = await receive_file(ticket);
        const files = result.file_names;
        const bytesList: Uint8Array[] = [];
        for (let i = 0; i < result.bytesArray.length; i++) {
            bytesList.push(new Uint8Array(result.bytesArray[i]));
        }

        for (let i = 0; i < files.length; i++) {
            triggerDownload(bytesList[i], files[i]);
        }

        inboundCard.close();
        inboundCard = null;
        showToast(`Received ${files.length} file(s) via DashBeam`, Toasts.Type.SUCCESS);
        return { kind: "success", files, bytesList };
    } catch (error) {
        console.error("[DashBeam] receive failed:", error);
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = /cancel/i.test(message);
        inboundCard?.close();
        inboundCard = null;
        if (cancelled) {
            showToast("Download cancelled", Toasts.Type.MESSAGE);
            return { kind: "cancelled" };
        }
        showToast(`DashBeam receive failed: ${message}`, Toasts.Type.FAILURE);
        return { kind: "failed" };
    }
}

// Metadata for a ticket, cached per ticket with in-flight dedup — React can
// double-invoke effects and several messages can carry the same link
export function fetchMetadata(ticket: string): Promise<FileMetadata | null> {
    if (metadataCache.has(ticket)) return Promise.resolve(metadataCache.get(ticket) ?? null);
    const inflight = metadataInflight.get(ticket);
    if (inflight) return inflight;

    const promise = ensureWasm()
        .then(() => fetch_ticket_metadata(ticket))
        .then(json => {
            const metadata = JSON.parse(json) as FileMetadata;
            metadataCache.set(ticket, metadata);
            return metadata;
        })
        .catch(error => {
            console.warn("[DashBeam] metadata fetch failed for ticket:", error);
            metadataCache.set(ticket, null);
            return null;
        })
        .finally(() => metadataInflight.delete(ticket));

    metadataInflight.set(ticket, promise);
    return promise;
}

export function getMetadataCache(ticket: string) {
    return metadataCache.get(ticket);
}

export function stopShare() {
    try {
        stop_sharing();
    } catch (error) {
        console.warn("[DashBeam] stop_sharing failed:", error);
    }
    activeShare = null;
    outboundCard?.close();
    outboundCard = null;
}

export function closeCards() {
    outboundCard?.close();
    outboundCard = null;
    inboundCard?.close();
    inboundCard = null;
}

// The engine aggregates progress across every connection request in the
// session: when a receiver cancels and re-accepts, the aborted request can
// linger in the active ledger, doubling the reported total and accumulating
// bytes across attempts. The sender knows the real size — the outbound card
// trusts activeShare.size and rebases its counter whenever a (re)connection
// opens a card
let outboundLoadedBaseline: number | null = null;

// On share-peer-connected the outbound card is created; import of
// createTransferProgressCard is used lazily here to keep this module's top
// level light. Called from routeEvent context via subscribe in index.tsx
export function openOutboundCard(fileName: string, total: number) {
    outboundCard?.close();
    // Stop here ends the whole share session (stop_sharing) — the receiver's
    // download will fail with a connection error on their side
    outboundCard = createTransferProgressCard("Sending", fileName, total, {
        cancelLabel: "Stop sharing",
        onCancel: () => stopShare()
    });
    // Captured from the first progress event after the card opens, so a
    // re-transfer after a receiver cancel restarts at 0% instead of
    // inheriting the cumulative engine counter
    outboundLoadedBaseline = null;
}

// Reset state on plugin stop — keeps lastSentShares/metadataCache (harmless,
// avoids refetching on re-enable)
export function resetRuntimeState() {
    dismissedTickets.clear();
    closeCards();
    activeShare = null;
}

// Same browser-download dance dashbeam's web client uses: materialize the
// bytes as a blob URL and click a hidden anchor. The filename is
// sender-controlled (embed metadata and collection entry names are not
// signed), so strip path separators and control chars before it reaches the
// filesystem — the Rust side blocks ../ traversal when exporting, but the
// blob download path is ours to harden
function triggerDownload(bytes: Uint8Array, fileName: string) {
    const safeName = sanitizeFileName(fileName);
    const blob = new Blob([new Uint8Array(bytes)]);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

// Path separators, traversal, and control characters out; keep a readable
// name. Empty results fall back to a generic one so nothing downloads as ""
// (which some browsers save with an OS-assigned name of their choosing)
export function sanitizeFileName(name: string) {
    const cleaned = name
        .replace(/[\\/]/g, "_")
        .replace(/\.{2,}/g, "_")
        .replace(/[ -]/g, "")
        .trim()
        .replace(/^\.+/, "")
        .slice(0, 255);
    return cleaned || "dashbeam-file";
}

// The sender's own embed card needs to react to transfer events; components
// subscribe through subscribe() and filter
export function isMyMessage(authorId: string) {
    return authorId === UserStore.getCurrentUser()?.id;
}
