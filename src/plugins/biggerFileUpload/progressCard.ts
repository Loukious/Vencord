/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Re-exported so index.tsx can hand it to definePlugin, which injects the
// stylesheet while the plugin is enabled and removes it when disabled
export { default as managedStyle } from "./styles.css?managed";

export interface UploadProgressCard {
    update(loaded: number, total: number): void;
    close(): void;
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

// The upload itself runs in the main process, and invoke-based IPC can't push
// events back — so the card is plain DOM outside React's tree, updated by a
// poller that reads the in-flight upload's byte count
export function createUploadProgressCard(uploader: string, fileName: string, initialTotal: number): UploadProgressCard {
    const card = document.createElement("div");
    card.className = "bfu-progress-card";

    const uploaderLabel = document.createElement("span");
    uploaderLabel.className = "bfu-progress-uploader";
    uploaderLabel.textContent = `Uploading to ${uploader}…`;

    const nameLabel = document.createElement("span");
    nameLabel.className = "bfu-progress-name";
    nameLabel.textContent = fileName;
    nameLabel.title = fileName;

    const bar = document.createElement("div");
    bar.className = "bfu-progress-bar";
    const fill = document.createElement("div");
    fill.className = "bfu-progress-fill";
    bar.appendChild(fill);

    const stats = document.createElement("div");
    stats.className = "bfu-progress-stats";
    const statsLeft = document.createElement("span");
    const statsRight = document.createElement("span");
    stats.append(statsLeft, statsRight);

    card.append(uploaderLabel, nameLabel, bar, stats);
    document.body.appendChild(card);

    let lastUpdate = performance.now();
    let lastLoaded = 0;
    let emaSpeed = 0;

    return {
        update(loaded: number, total: number) {
            const now = performance.now();
            const dt = (now - lastUpdate) / 1000;
            if (dt > 0) {
                const instant = Math.max(0, (loaded - lastLoaded) / dt);
                // Moving average smooths the jitter between 500ms polls
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
            card.classList.add("bfu-closing");
            setTimeout(() => card.remove(), 300);
        }
    };
}
