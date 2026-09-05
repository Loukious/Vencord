/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { formatBytes } from "@plugins/dashbeam.desktop/progressCard";
import { acceptTicket, DASHBEAM_TICKET_REGEX, dismissedTickets, fetchMetadata, FileMetadata, getMetadataCache, isMyMessage, lastSentShares, openOutboundCard, RECEIVE_LINK_BASE, setClaimedSizeForInbound, stopShare, subscribe } from "@plugins/dashbeam.desktop/shareState";
import { Message } from "@vencord/discord-types";
import { Button, useEffect, useState } from "@webpack/common";

// Registered in start() via addMessageAccessory. Runs for EVERY message, so
// the regex test is the first statement and everything else is behind it
export function dashBeamAccessory(props: Record<string, any>) {
    const content: string | undefined = props?.message?.content;
    if (!content) return null;

    const match = DASHBEAM_TICKET_REGEX.exec(content);
    if (!match) return null;

    return <DashBeamCard key={match[1]} ticket={match[1]} message={props.message as Message} />;
}

type CardStatus = "loading" | "ready" | "accepted" | "done" | "failed" | "unavailable" | "sharing";

function DashBeamCard({ ticket, message }: { ticket: string; message: Message; }) {
    const mine = isMyMessage(message.author?.id ?? "");

    const [dismissed, setDismissed] = useState(dismissedTickets.has(ticket));
    const [meta, setMeta] = useState<FileMetadata | null>(() => {
        if (mine) return lastSentShares.get(ticket) ?? null;
        return getMetadataCache(ticket) ?? null;
    });
    const [status, setStatus] = useState<CardStatus>(mine ? "sharing" : "loading");
    const [statusLine, setStatusLine] = useState<string | null>(null);

    // Receiver: fetch metadata once (in-flight dedup lives in shareState)
    useEffect(() => {
        if (mine || meta) return;
        let cancelled = false;
        fetchMetadata(ticket).then(result => {
            if (cancelled) return;
            if (result) {
                setMeta(result);
                setStatus("ready");
            } else {
                setStatus("unavailable");
            }
        });
        return () => { cancelled = true; };
    }, [ticket, mine, meta]);

    // Sender: react to transfer lifecycle for this ticket — the wasm has one
    // session, so if this is our share the events are ours
    useEffect(() => {
        if (!mine) return;
        return subscribe((eventName, payload) => {
            switch (eventName) {
                case "share-peer-connected":
                    setStatusLine("Receiver connected — transferring…");
                    openOutboundCard(lastSentShares.get(ticket)?.file_name ?? "file", lastSentShares.get(ticket)?.size ?? 0);
                    break;
                case "transfer-completed": {
                    const detail = payload ? JSON.parse(payload) : null;
                    setStatusLine(detail ? `Sent ✓ (${formatBytes(detail.bytes ?? 0)})` : "Sent ✓");
                    break;
                }
                case "transfer-failed":
                    setStatusLine("Transfer failed");
                    break;
                case "relay-fell-back":
                    setStatusLine("Relay fell back to public — continuing");
                    break;
            }
        });
    }, [ticket, mine]);

    if (dismissed) return null;

    const fileName = meta?.file_name ?? "Unknown file";
    const size = meta?.size ?? (mine ? lastSentShares.get(ticket)?.size ?? 0 : 0);
    const itemCount = meta?.item_count ?? 1;
    const mimeType = meta?.mime_type;

    function handleAccept() {
        setStatus("accepted");
        setStatusLine("Receiving…");
        // Metadata size is sender-claimed; the progress check compares the
        // real wire total against it and warns on a bait-and-switch
        setClaimedSizeForInbound(meta?.size ?? null);
        acceptTicket(ticket).then(result => {
            if (result.kind === "success") {
                setStatus("done");
                setStatusLine(`Received ✓ ${result.files.length} file(s)`);
            } else if (result.kind === "cancelled") {
                // A cancelled download can be restarted — back to ready
                setStatus("ready");
                setStatusLine(null);
            } else {
                setStatus("failed");
                setStatusLine("Receive failed — the sender may have stopped sharing");
            }
        });
    }

    function handleDecline() {
        dismissedTickets.add(ticket);
        setDismissed(true);
    }

    function handleOpenInBrowser() {
        VencordNative.native.openExternal(`${RECEIVE_LINK_BASE}?ticket=${encodeURIComponent(ticket)}`);
    }

    return (
        <div className="db-embed-card">
            <div className="db-embed-header">
                <span className="db-embed-name" title={fileName}>{fileName}</span>
            </div>
            <div className="db-embed-meta">
                <span>{formatBytes(size)}</span>
                {itemCount > 1 && <span>{itemCount} items</span>}
                {mimeType && <span>{mimeType}</span>}
            </div>

            {!mine && (
                <div className="db-embed-warning">
                    File details are claimed by the sender and can be spoofed — only accept files from people you trust.
                </div>
            )}

            {mine ? (
                <div className="db-embed-status">{statusLine ?? "Sharing — waiting for a receiver…"}</div>
            ) : (
                <div className={`db-embed-status ${status === "done" ? "db-status-ok" : status === "failed" || status === "unavailable" ? "db-status-error" : ""}`}>
                    {status === "loading" && "Loading share info…"}
                    {status === "unavailable" && "Share unavailable — the sender may have stopped sharing. The link may still work in a browser."}
                    {statusLine}
                </div>
            )}

            <div className="db-embed-buttons">
                <Button
                    color={Button.Colors.LINK}
                    size={Button.Sizes.SMALL}
                    onClick={handleOpenInBrowser}
                >
                    Open in browser
                </Button>
                {mine ? (
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        onClick={() => { stopShare(); setStatusLine("Share stopped"); }}
                    >
                        Stop Sharing
                    </Button>
                ) : (status === "ready" || status === "loading") && (
                    <>
                        <Button
                            color={Button.Colors.PRIMARY}
                            size={Button.Sizes.SMALL}
                            disabled={status === "loading"}
                            onClick={handleAccept}
                        >
                            Accept
                        </Button>
                        <Button
                            color={Button.Colors.TRANSPARENT}
                            size={Button.Sizes.SMALL}
                            onClick={handleDecline}
                        >
                            Decline
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
