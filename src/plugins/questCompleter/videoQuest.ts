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

import { postVideoProgress, startVideoQuestAnalytics } from "@plugins/questCompleter/analytics";
import { completeQuest, runQuestStep } from "@plugins/questCompleter/completion";
import {
    VIDEO_FINAL_TIMESTAMP_OVERSHOOT_SEC,
    VIDEO_FIRST_PROGRESS_DELAY_MS,
    VIDEO_PROGRESS_JITTER_SEC,
    VIDEO_PROGRESS_POST_INTERVAL_SEC
} from "@plugins/questCompleter/constants";
import { getQuestProgress, isQuestCompleted } from "@plugins/questCompleter/quests";
import { isQuestRunning } from "@plugins/questCompleter/state";
import type { QuestCompletionContext } from "@plugins/questCompleter/types";

export async function completeVideoQuest(context: QuestCompletionContext) {
    const { quest, questName, secondsNeeded, taskName } = context;
    const progressAtStart = getQuestProgress(quest, taskName);
    const startTime = Date.now();

    console.log(`[Quest] Starting ${taskName}: ${questName} at ${progressAtStart}/${secondsNeeded}s`);

    // Fractional timestamps, like the video.currentTime values the official modal posts
    const getCurrentProgress = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        return Math.min(progressAtStart + elapsed, secondsNeeded);
    };

    const analytics = startVideoQuestAnalytics(context, getCurrentProgress);
    context.runningQuest.cleanup = () => analytics.stop();

    // The official modal posts on the first progress update and then whenever video
    // time passes the last posted timestamp + 6s + up to 2s of jitter; nextPostAt is
    // the progress-clock gate, starting at 0 so the first post goes out immediately
    let lastSubmittedProgress = progressAtStart;
    let nextPostAt = 0;

    const scheduleNextPost = (delaySec: number) => {
        context.runningQuest.progressTimeout = setTimeout(() => {
            void runQuestStep(context, saveProgress);
        }, Math.max(0, delaySec) * 1000);
    };

    const saveProgress = async () => {
        if (!isQuestRunning(quest.id)) return;

        // The official ended handler posts duration + 1s, overshooting the required target
        const isFinal = getCurrentProgress() >= secondsNeeded;
        const timestamp = isFinal
            ? secondsNeeded + VIDEO_FINAL_TIMESTAMP_OVERSHOOT_SEC + Math.random()
            : Math.max(getCurrentProgress(), lastSubmittedProgress);

        if (!isFinal && timestamp < nextPostAt) {
            scheduleNextPost(nextPostAt - timestamp);
            return;
        }

        const response = await postVideoProgress(quest.id, timestamp);

        if (!isQuestRunning(quest.id)) return;

        lastSubmittedProgress = timestamp;
        analytics.trackProgressed(timestamp);

        if (isQuestCompleted(context, response)) {
            console.log("[Quest] Server confirmed video completion.");
            analytics.markCompleted();
            completeQuest(context);
            return;
        }

        console.log(`[Quest] Saved video progress at ${timestamp.toFixed(2)}/${secondsNeeded}s.`);
        nextPostAt = timestamp + VIDEO_PROGRESS_POST_INTERVAL_SEC + Math.random() * VIDEO_PROGRESS_JITTER_SEC;
        scheduleNextPost(nextPostAt - getCurrentProgress());
    };

    scheduleNextPost(VIDEO_FIRST_PROGRESS_DELAY_MS / 1000);
}
