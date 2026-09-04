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

import { VIDEO_SEGMENT_EMIT_INTERVAL_MS, VIDEO_SEGMENT_MIN_DURATION_SEC } from "@plugins/questCompleter/constants";
import { getQuestById, isQuestUserStatusCompleted } from "@plugins/questCompleter/quests";
import type { QuestCompletionContext } from "@plugins/questCompleter/types";
import { findStoreLazy, mapMangledModuleLazy } from "@webpack";
import { RestAPI } from "@webpack/common";

// Discord's trackQuestEvent helper enriches every event with quest_id, quest_type,
// application_ids, quest_status and ad session ids before handing it to the science
// tracker, so we reuse it instead of building the base properties ourselves.
// Note: this must be looked up via mapMangledModule (module factory code search) —
// the "[Quest] AnalyticsUtils.track" string lives in a non-exported helper, so
// findByCode, which only inspects exported functions, can never match it.
// The mapper picks the av export, the only one building quest_type/quest_status.
const { av: trackQuestEventFn } = mapMangledModuleLazy("[Quest] AnalyticsUtils.track", {
    av: (m: any) => typeof m === "function" && Function.prototype.toString.call(m).includes("quest_type:")
});
const NetworkStore: any = findStoreLazy("NetworkStore");

// Event names from Discord's QuestAnalyticsEvents enum
const QuestVideoAnalyticsEvents = {
    LOADING_STARTED: "quest_video_loading_started",
    LOADING_ENDED: "quest_video_loading_ended",
    TIME_TO_FIRST_FRAME: "quest_video_time_to_first_frame",
    PROGRESSED: "quest_video_progressed",
    SEGMENT_WATCHED: "quest_video_segment_watched",
    MODAL_CLOSED: "quest_video_modal_closed"
} as const;

// What Discord sends for the HLS level fields while no HLS level is resolved
const UNRESOLVED_HLS_INFO = {
    hls_level_index: -100,
    hls_segment_res_width: -100,
    hls_segment_res_height: -100
};

export function buildVideoProgressTrackedActionData(questId: string, timestamp: number) {
    return {
        event: "network_action_quest_video_progress",
        properties: {
            quest_id: questId,
            timestamp_sec: String(timestamp),
            stack_trace: new Error().stack ?? ""
        }
    };
}

/**
 * Posts video progress the way Discord's action does, including the
 * trackedActionData the network layer reports for the request.
 */
export function postVideoProgress(questId: string, timestamp: number) {
    return RestAPI.post({
        url: `/quests/${questId}/video-progress`,
        body: { timestamp },
        trackedActionData: buildVideoProgressTrackedActionData(questId, timestamp)
    } as any);
}

function trackQuestEvent(questId: string, event: string, properties: Record<string, unknown>) {
    try {
        trackQuestEventFn?.({ questId, event, properties });
    } catch (error) {
        console.error("[Quest] Failed to track analytics event:", error);
    }
}

function getNetworkConnectionSpeed() {
    try {
        return NetworkStore?.getEffectiveConnectionSpeed?.() ?? "unknown";
    } catch {
        return "unknown";
    }
}

// Mirrors Discord's video progress ratio helper: clamped to 0..1, rounded to 2 decimals
function getVideoProgressRatio(current: number, duration: number) {
    if (current <= 0 || duration <= 0) return 0;
    if (current >= duration) return 1;
    return Math.min(1, Math.round((current / duration) * 100) / 100);
}

function getVideoAssetId(quest: any, taskName: string) {
    const assets = quest.config.taskConfigV2.tasks[taskName]?.assets;
    return assets?.videoHls != null ? "video_player_video_hls" : "video_player_video";
}

export interface VideoQuestAnalyticsSession {
    /** Emit a PROGRESSED event for a timestamp that was just posted to the API */
    trackProgressed(timestamp: number): void;
    /** Mark the quest as completed so stop() skips the final progress re-post */
    markCompleted(): void;
    /** Emit the final segment, PROGRESSED and MODAL_CLOSED events, like Discord's modal close handler */
    stop(): void;
}

/**
 * Emits the science event session Discord's video quest modal produces while
 * watching a video, so the spoofed video progress doesn't stand out as coming
 * from a client that never opened the modal.
 */
export function startVideoQuestAnalytics(context: QuestCompletionContext, getCurrentVideoTime: () => number): VideoQuestAnalyticsSession {
    const { quest, secondsNeeded, taskName } = context;
    const videoSessionId = crypto.randomUUID();
    const videoAssetId = getVideoAssetId(quest, taskName);
    // The video is slightly longer than the required watch time, which is what
    // makes the official duration + 1s final post overshoot the target
    const videoDuration = secondsNeeded + 2 + Math.random() * 8;

    let stopped = false;
    let completed = false;
    let maxTimestamp = 0;
    let segmentStartWallMs = Date.now();
    let segmentStartSec = getCurrentVideoTime();
    let segmentTimer: ReturnType<typeof setTimeout> | null = null;

    const emit = (event: string, properties: Record<string, unknown>) =>
        trackQuestEvent(quest.id, event, properties);

    const isQuestCompletedNow = () => {
        if (completed) return true;
        return isQuestUserStatusCompleted(getQuestById(quest.id)?.userStatus);
    };

    // Loading sequence, matching the order the modal's video element fires them in
    emit(QuestVideoAnalyticsEvents.LOADING_STARTED, {
        video_asset_id: videoAssetId,
        network_connection_speed: getNetworkConnectionSpeed(),
        video_session_id: videoSessionId,
        is_hls_supported: true,
        ...UNRESOLVED_HLS_INFO
    });
    const timeToFirstFrameMs = 250 + Math.random() * 500;
    setTimeout(() => {
        if (stopped) return;
        emit(QuestVideoAnalyticsEvents.TIME_TO_FIRST_FRAME, {
            duration_ms: Math.round(timeToFirstFrameMs),
            video_session_id: videoSessionId,
            video_asset_id: videoAssetId,
            ...UNRESOLVED_HLS_INFO
        });
    }, timeToFirstFrameMs);
    setTimeout(() => {
        if (stopped) return;
        emit(QuestVideoAnalyticsEvents.LOADING_ENDED, {
            video_asset_id: videoAssetId,
            network_connection_speed: getNetworkConnectionSpeed(),
            duration: videoDuration,
            video_session_id: videoSessionId,
            ...UNRESOLVED_HLS_INFO
        });
    }, timeToFirstFrameMs + 100 + Math.random() * 400);

    const emitSegmentWatched = (endWallMs: number, endSec: number) => {
        emit(QuestVideoAnalyticsEvents.SEGMENT_WATCHED, {
            start_time: segmentStartWallMs,
            end_time: endWallMs,
            duration: endWallMs - segmentStartWallMs,
            segment_start_sec: segmentStartSec,
            segment_end_sec: endSec,
            segment_duration_sec: endSec - segmentStartSec,
            video_asset_id: videoAssetId,
            quest_completed: isQuestCompletedNow(),
            video_duration_sec: videoDuration,
            video_progress: getVideoProgressRatio(endSec, videoDuration),
            video_session_id: videoSessionId,
            ...UNRESOLVED_HLS_INFO
        });
    };

    // Segment watcher: emit a watched segment every 4s, dropping segments under 2s
    const segmentLoop = () => {
        if (stopped) return;

        const now = Date.now();
        const currentSec = getCurrentVideoTime();
        if (currentSec - segmentStartSec >= VIDEO_SEGMENT_MIN_DURATION_SEC) {
            emitSegmentWatched(now, currentSec);
            segmentStartWallMs = now;
            segmentStartSec = currentSec;
        }

        segmentTimer = setTimeout(segmentLoop, VIDEO_SEGMENT_EMIT_INTERVAL_MS);
    };
    segmentTimer = setTimeout(segmentLoop, VIDEO_SEGMENT_EMIT_INTERVAL_MS);

    return {
        trackProgressed(timestamp) {
            if (stopped) return;

            maxTimestamp = Math.max(maxTimestamp, timestamp);
            emit(QuestVideoAnalyticsEvents.PROGRESSED, {
                progress: getVideoProgressRatio(timestamp, videoDuration),
                video_timestamp_seconds: timestamp,
                video_session_id: videoSessionId,
                video_asset_id: videoAssetId,
                ...UNRESOLVED_HLS_INFO
            });
        },

        markCompleted() {
            completed = true;
        },

        stop() {
            if (stopped) return;
            stopped = true;

            if (segmentTimer != null) clearTimeout(segmentTimer);

            const now = Date.now();
            const finalSec = Math.max(maxTimestamp, getCurrentVideoTime());

            // Flush the trailing segment if it is longer than 0.2s, like the segment watcher does
            if (finalSec - segmentStartSec > 0.2) {
                emitSegmentWatched(now, finalSec);
            }

            const progress = getVideoProgressRatio(finalSec, videoDuration);
            emit(QuestVideoAnalyticsEvents.PROGRESSED, {
                progress,
                video_timestamp_seconds: finalSec,
                video_session_id: videoSessionId
            });
            emit(QuestVideoAnalyticsEvents.MODAL_CLOSED, {
                video_progress: progress,
                video_session_id: videoSessionId,
                network_connection_speed: getNetworkConnectionSpeed()
            });

            // The modal close handler re-posts the max timestamp, but only while the
            // quest is still enrolled and unfinished
            if (!isQuestCompletedNow()) {
                void postVideoProgress(quest.id, finalSec)
                    .catch(error => console.error("[Quest] Failed to re-post final video progress:", error));
            }
        }
    };
}
