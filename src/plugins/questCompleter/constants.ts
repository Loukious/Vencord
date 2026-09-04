/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

export const FLUX_EVENTS = {
    RUNNING_GAMES: "RUNNING_GAMES_CHANGE"
} as const;

export const cdnBaseUrl = "https://cdn.discordapp.com/";
export const questAssetsBaseUrl = `${cdnBaseUrl}quests/`;

export const QUEST_TASKS = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"] as const;
export type QuestTaskName = typeof QUEST_TASKS[number];

export const HEARTBEAT_QUEST_TASKS = new Set<QuestTaskName>(["PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"]);

// Tasks whose terminal heartbeat the plugin sends itself. PLAY_ON_DESKTOP and
// STREAM_ON_DESKTOP are deliberately absent: their fake game/stream metadata
// makes Discord's own QuestProgressManager send every beat, and that scheduler
// also owns the terminal heartbeat (it fires one when the spoofed activity is
// removed while the quest is unfinished).
export const MANUAL_HEARTBEAT_TERMINAL_TASKS = new Set<QuestTaskName>(["PLAY_ACTIVITY"]);

export const QUEST_ERROR_MESSAGES: Record<QuestTaskName, string> = {
    WATCH_VIDEO: "Failed to update video progress",
    WATCH_VIDEO_ON_MOBILE: "Failed to update video progress",
    PLAY_ON_DESKTOP: "Failed to update game progress",
    STREAM_ON_DESKTOP: "Failed to update stream progress",
    PLAY_ACTIVITY: "Failed to update activity progress"
};

export const HEARTBEAT_MAX_INTERVAL_MS = 60 * 1000;
export const HEARTBEAT_FINAL_BUFFER_MS = 1000;

// Near the target the official cadence collapses to ~1s per beat while the
// server confirms the last seconds; give up if it never confirms completion
export const HEARTBEAT_STALLED_BEAT_LIMIT = 5;

// How often the desktop/stream quest watchers poll the quest store for
// completion while Discord's own heartbeat scheduler does the beating
export const QUEST_WATCH_INTERVAL_MS = 2000;

// Video progress posts mirror Discord's video modal: the current timestamp is posted
// on the first progress update, then again once video time passes the last posted
// timestamp + 6s plus up to 2s of jitter (aA/A6 in the official bundle)
export const VIDEO_FIRST_PROGRESS_DELAY_MS = 250;
export const VIDEO_PROGRESS_POST_INTERVAL_SEC = 6;
export const VIDEO_PROGRESS_JITTER_SEC = 2;
// The official ended handler posts duration + 1s, overshooting the required target
export const VIDEO_FINAL_TIMESTAMP_OVERSHOOT_SEC = 1;

// Discord's segment watcher emits a watched-segment event every 4s of playback,
// dropping segments shorter than 2s (KI/_4 in the official bundle)
export const VIDEO_SEGMENT_EMIT_INTERVAL_MS = 4 * 1000;
export const VIDEO_SEGMENT_MIN_DURATION_SEC = 2;

export const isApp = navigator.userAgent.includes("Electron/");
