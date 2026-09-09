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

import { showNotification } from "@api/Notifications";
import { completeAchievementQuest } from "@plugins/questCompleter/achievementQuests";
import { getQuestImageConfig } from "@plugins/questCompleter/assets";
import { runQuestStep } from "@plugins/questCompleter/completion";
import { APPLICATION_QUEST_TASKS, isApp, QUEST_TASKS } from "@plugins/questCompleter/constants";
import { completeActivityQuest, completeDesktopQuest, completeStreamQuest } from "@plugins/questCompleter/heartbeatQuests";
import { AutoCompleteIcon, StopCompletingIcon } from "@plugins/questCompleter/icons";
import { ApplicationStreamingStore, enrollQuest, getQuestById, getTaskApplication, sleep } from "@plugins/questCompleter/quests";
import { QuestCompleterSettings } from "@plugins/questCompleter/settings";
import { emitRunningQuestsChange, endQuest, runningQuests, stopQuest } from "@plugins/questCompleter/state";
import type { QuestCompletionContext, QuestTaskName, RunningQuest } from "@plugins/questCompleter/types";
import { completeVideoQuest } from "@plugins/questCompleter/videoQuest";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { showToast, Toasts, VoiceStateStore } from "@webpack/common";

const questCompleters: Record<QuestTaskName, (context: QuestCompletionContext) => Promise<void> | void> = {
    WATCH_VIDEO: completeVideoQuest,
    WATCH_VIDEO_ON_MOBILE: completeVideoQuest,
    PLAY_ON_DESKTOP: completeDesktopQuest,
    STREAM_ON_DESKTOP: completeStreamQuest,
    PLAY_ACTIVITY: completeActivityQuest,
    ACHIEVEMENT_IN_ACTIVITY: completeAchievementQuest
};

export default definePlugin({
    name: "QuestCompleter",
    description: "Auto complete quests without any requirements.",
    authors: [Devs.Loukious],
    patches: [
        {
            find: 'id:"share-link"',
            replacement: {
                // Injects an "Auto Complete" item into the quest context menu, built with the
                // same MenuItem component and icon/leadingAccessory props as the native items
                // (e.g. the "share-link" one it anchors on). Captures:
                // $1 = props of the menu component (holds quest.id), $2 = code in between,
                // $3 = share-link gate ("K &&"), $4/$5 = jsx runtime, $6/$7 = MenuItem component
                match: /questId:(\i)\.quest\.id(.{0,5000}?)(\i&&\(0,(\i)\.(\i)\)\((\i)\.(\i),\{id:"share-link")/,
                replace: 'questId:$1.quest.id$2(0,$4.$5)($6.$7,{id:"quest-completer",label:$self.autoCompleteLabel($1.quest.id),action:()=>$self.openCompleteQuest($1.quest.id),icon:$self.autoCompleteIcon($1.quest.id),leadingAccessory:{type:"icon",icon:$self.autoCompleteIcon($1.quest.id)}}),$3'
            }
        }
    ],

    settingsAboutComponent: QuestCompleterSettings,

    autoCompleteLabel(questId: string) {
        return runningQuests.has(questId) ? "Stop Completing" : "Auto Complete";
    },

    autoCompleteIcon(questId: string) {
        return runningQuests.has(questId) ? StopCompletingIcon : AutoCompleteIcon;
    },

    start() { },

    stop() {
        for (const questId of Array.from(runningQuests.keys())) endQuest(questId);
    },

    async openCompleteQuest(questId: string) {
        let quest = getQuestById(questId);
        if (!quest) {
            showToast("Quest not found!");
            return;
        }

        // Changed to stop if already running
        if (runningQuests.has(quest.id)) {
            stopQuest(quest.id);
            return;
        }

        const taskName = QUEST_TASKS.find(x => quest.config.taskConfigV2.tasks[x] != null);

        if (quest.userStatus?.completedAt) {
            showToast("This quest is already completed!");
            return;
        }

        if (new Date(quest.config.expiresAt).getTime() < Date.now()) {
            showToast("This quest has expired!");
            return;
        }

        if (!taskName) {
            showToast("Unsupported quest type!");
            return;
        }

        if (!quest.userStatus?.enrolledAt) {
            showToast("Attempting to enroll in quest...");
            // Discord's own enroll action, so the QUESTS_ENROLL_SUCCESS dispatch
            // puts enrolledAt into the quest store — the official heartbeat
            // scheduler requires it before beating for a quest.
            // 1 = DESKTOP_ACCOUNT_PANEL_AREA, a valid QuestContentPlacement (the
            // enum is 0-5), matching what the client sends when accepting a
            // quest from the desktop quest bar
            let result: { type: string; } | undefined;
            try {
                result = await enrollQuest(quest.id, 1);
            } catch (error) {
                console.error("[Quest] Failed to run enroll action:", error);
            }
            if (result?.type !== "success") {
                if (result?.type === "captcha_failed") {
                    showToast("Enrollment requires a captcha. Please enroll manually!");
                } else if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
                    showToast("You need to start playing the video first, then pause it or accept the quest!");
                } else {
                    showToast("Failed to auto enroll in the quest. Please try manually.");
                }
                return;
            } else {
                showToast("Successfully auto enrolled in the quest!");
                await sleep(2000);
                quest = getQuestById(questId);
                if (!quest) {
                    showToast("Quest not found!");
                    return;
                }
            }
        }

        const currentStream = ApplicationStreamingStore.getCurrentUserActiveStream();

        try {
            if (taskName === "STREAM_ON_DESKTOP" && !isApp) {
                showToast("Desktop app required for streaming quests!", Toasts.Type.FAILURE);
                return;
            }

            if (taskName === "STREAM_ON_DESKTOP") {
                if (!currentStream) {
                    showToast("You need to be streaming to complete this quest!");
                    return;
                }

                // Official gate: the scheduler only beats while at least one
                // other user is in the voice channel
                if ((VoiceStateStore as any).countVoiceStatesForChannel(currentStream.channelId) < 2) {
                    showToast("You need at least one other user in your voice channel!");
                    return;
                }
            }

            if (taskName === "PLAY_ON_DESKTOP" && !isApp) {
                showToast("Desktop app required for gameplay quests!");
                return;
            }
        } catch (error) {
            showToast(error instanceof Error ? error.message : "An unknown error occurred");
            return;
        }

        const taskApplication = getTaskApplication(quest, taskName);
        const requiresApplication = APPLICATION_QUEST_TASKS.has(taskName);
        if (requiresApplication && !taskApplication?.id) {
            console.error("[Quest] Application data missing:", {
                questId: quest.id,
                taskName,
                task: quest.config.taskConfigV2.tasks[taskName]
            });

            showToast("This quest does not contain application data!", Toasts.Type.FAILURE);
            return;
        }

        const applicationId = taskApplication?.id ?? "";
        const applicationName =
            taskApplication?.name
            ?? quest.config.messages.gameTitle
            ?? quest.config.messages.questName
            ?? "Discord Quest";

        const questName =
            quest.config.messages.questName
            ?? quest.config.messages.gameTitle
            ?? "Discord Quest";

        const secondsNeeded = quest.config.taskConfigV2.tasks[taskName].target;

        const runningQuest: RunningQuest = {
            questId: quest.id,
            applicationName,
            questName,
            taskName
        };
        runningQuests.set(quest.id, runningQuest);
        emitRunningQuestsChange();

        const showQuestNotification = (title: string, body: string) => {
            showNotification({
                title: `${questName} - ${title}`,
                body: `${body}`,
                ...getQuestImageConfig(quest.id)
            });
        };

        const context: QuestCompletionContext = {
            quest,
            currentStream,
            runningQuest,
            applicationId,
            applicationName,
            questName,
            secondsNeeded,
            taskName,
            showQuestNotification
        };

        showToast(`Starting quest: ${questName}`, Toasts.Type.SUCCESS);
        void runQuestStep(context, () => questCompleters[taskName](context));
    }
});
