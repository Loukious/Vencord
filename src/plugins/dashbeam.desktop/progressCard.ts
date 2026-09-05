/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Re-exported so index.tsx can hand it to definePlugin, which injects the
// stylesheet while the plugin is enabled and removes it when disabled
export { default as managedStyle } from "./styles.css?managed";

export interface TransferProgressCard {
    update(loaded: number, total: number): void;
    close(): void;
}

export interface ProgressCardOptions {
    /** Rendered as a destructive button; the receiver's cancel aborts the
     *  download, the sender's stop ends the share session. */
    onCancel?: () => void;
    cancelLabel?: string;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(seconds: number) {
    if (!Number.isFinite(seconds)) return "";
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.ceil(seconds)}s`;
}

// Same DOM-outside-React approach as biggerFileUpload's card, but fed by wasm
// progress events instead of a poller — both ends of a DashBeam transfer use
// it ("Sending" on the sender, "Receiving" on the receiver)
export function createTransferProgressCard(role: "Sending" | "Receiving", fileName: string, initialTotal: number, options: ProgressCardOptions = {}): TransferProgressCard {
    const card = document.createElement("div");
    card.className = "db-progress-card";

    const roleLabel = document.createElement("span");
    roleLabel.className = "db-progress-role";
    roleLabel.textContent = `${role} "${fileName}" via DashBeam…`;

    const bar = document.createElement("div");
    bar.className = "db-progress-bar";
    const fill = document.createElement("div");
    fill.className = "db-progress-fill";
    bar.appendChild(fill);

    const stats = document.createElement("div");
    stats.className = "db-progress-stats";
    const statsLeft = document.createElement("span");
    const statsRight = document.createElement("span");
    stats.append(statsLeft, statsRight);

    card.append(roleLabel, bar, stats);

    // Destructive action: receiver-side aborts the download (cancel_receive),
    // sender-side ends the share session (stop_sharing)
    if (options.onCancel) {
        const cancelRow = document.createElement("div");
        cancelRow.className = "db-progress-actions";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "db-progress-cancel";
        cancelBtn.textContent = options.cancelLabel ?? "Cancel";
        cancelBtn.addEventListener("click", options.onCancel);
        cancelRow.appendChild(cancelBtn);
        card.appendChild(cancelRow);
    }

    document.body.appendChild(card);

    let lastUpdate = performance.now();
    let lastLoaded = 0;
    let emaSpeed = 0;
    let closed = false;

    return {
        update(loaded: number, total: number) {
            if (closed) return;
            const now = performance.now();
            const dt = (now - lastUpdate) / 1000;
            if (dt > 0) {
                const instant = Math.max(0, (loaded - lastLoaded) / dt);
                // Moving average smooths the jitter between wasm progress
                // events (throttled to 1MB / 0.2s in the engine)
                emaSpeed = emaSpeed === 0 ? instant : emaSpeed * 0.7 + instant * 0.3;
            }
            lastUpdate = now;
            lastLoaded = loaded;

            const safeTotal = total > 0 ? total : initialTotal;
            const percent = safeTotal > 0 ? Math.min(100, (loaded / safeTotal) * 100) : 0;
            fill.style.width = `${percent.toFixed(1)}%`;

            const remaining = emaSpeed > 0 ? (safeTotal - loaded) / emaSpeed : Infinity;
            statsLeft.textContent = `${formatBytes(loaded)} / ${formatBytes(safeTotal)}`;
            const eta = formatDuration(remaining);
            statsRight.textContent = eta ? `${formatBytes(emaSpeed)}/s · ${eta} left` : `${formatBytes(emaSpeed)}/s`;
        },
        close() {
            if (closed) return;
            closed = true;
            card.classList.add("db-closing");
            setTimeout(() => card.remove(), 300);
        }
    };
}

export { formatBytes, formatDuration };
