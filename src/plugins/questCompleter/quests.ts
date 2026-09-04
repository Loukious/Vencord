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

import type { QuestTaskName } from "@plugins/questCompleter/constants";
import type { QuestCompletionContext, QuestHeartbeatOptions } from "@plugins/questCompleter/types";
import { findByCode, findByProps, findStoreLazy } from "@webpack";

export const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");

let questsHeartbeat: ((options: QuestHeartbeatOptions) => Promise<any>) | undefined;
let questsEnroll: ((questId: string, options: { questContent: number }) => Promise<{ type: string }>) | undefined;
let questsFetchCurrent: (() => Promise<void>) | undefined;

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getQuestById(questId: string) {
    const QuestsStore = findByProps("getQuest");
    return QuestsStore.quests.get(questId);
}

export function encodeStreamKey(e): string {
    const { streamType: t, guildId: n, channelId: r, ownerId: s } = e;
    switch (t) {
        case "guild":
            if (!n) throw new Error("guildId is required for streamType GUILD");
            return [t, n, r, s].join(":");
        case "call":
            return [t, r, s].join(":");
        default:
            throw new Error("Unknown stream type ".concat(t));
    }
}

export function getQuestProgress(quest: any, taskName: QuestTaskName) {
    return quest.config.configVersion === 1
        ? quest.userStatus?.streamProgressSeconds ?? 0
        : quest.userStatus?.progress?.[taskName]?.value ?? 0;
}

export function getTaskApplication(quest: any, taskName: QuestTaskName) {
    return quest.config.taskConfigV2.tasks[taskName]?.applications?.[0] ?? null;
}

export function isQuestUserStatusCompleted(userStatus: any) {
    return userStatus?.completedAt != null || userStatus?.completed_at != null;
}

export function isQuestExpired(quest: any) {
    return quest?.config?.expiresAt != null && new Date(quest.config.expiresAt).getTime() <= Date.now();
}

export function getLatestQuestProgress(context: QuestCompletionContext, fallbackProgress = 0) {
    const quest = getQuestById(context.quest.id) ?? context.quest;
    return Math.max(getQuestProgress(quest, context.taskName), fallbackProgress);
}

export function getHeartbeatResponseStatus(response: any) {
    return response?.body?.userStatus ?? response?.body?.user_status ?? response?.body;
}

export function getHeartbeatResponseProgress(context: QuestCompletionContext, response: any) {
    const status = getHeartbeatResponseStatus(response);
    return status?.progress?.[context.taskName]?.value
        ?? status?.streamProgressSeconds
        ?? status?.stream_progress_seconds
        ?? 0;
}

export function isHeartbeatCompleted(response: any) {
    const status = getHeartbeatResponseStatus(response);
    return isQuestUserStatusCompleted(status);
}

export function isQuestCompleted(context: QuestCompletionContext, response?: any) {
    if (response && isHeartbeatCompleted(response)) return true;

    const quest = getQuestById(context.quest.id);
    return isQuestUserStatusCompleted(quest?.userStatus);
}

export function sendQuestHeartbeat(options: QuestHeartbeatOptions) {
    questsHeartbeat ??= findByCode("QUESTS_HEARTBEAT");
    if (!questsHeartbeat) throw new Error("Failed to find quest heartbeat action");

    return questsHeartbeat(options);
}

/**
 * Enrolls via Discord's own enroll action instead of a raw REST post. The
 * action dispatches QUESTS_ENROLL_SUCCESS with the enrolled user status, which
 * is what puts enrolledAt into the quest store — the official heartbeat
 * scheduler refuses to beat for a quest until it sees that. The
 * "QUESTS_ENROLL_BEGIN" anchor only exists in the exported action; the quest
 * store's handler containing the same string is not an exported function, so
 * findByCode (which inspects exported functions only) cannot match it.
 */
export function enrollQuest(questId: string, questContent: number) {
    questsEnroll ??= findByCode("QUESTS_ENROLL_BEGIN");
    if (!questsEnroll) throw new Error("Failed to find quest enroll action");

    return questsEnroll(questId, { questContent });
}

/**
 * Runs Discord's fetchCurrentQuests action. Its QUESTS_FETCH_CURRENT_QUESTS_SUCCESS
 * dispatch is one of the official heartbeat scheduler's sync triggers for stream
 * quests — calling it right after patching the stream metadata makes the
 * scheduler pick the quest up immediately instead of waiting for the next voice
 * event. The "QUESTS_FETCH_CURRENT_QUESTS_BEGIN" anchor only exists in this
 * exported action (the quest store's handler containing the same string is not
 * an exported function).
 */
export function fetchCurrentQuests() {
    questsFetchCurrent ??= findByCode("QUESTS_FETCH_CURRENT_QUESTS_BEGIN");
    if (!questsFetchCurrent) throw new Error("Failed to find quest fetch action");

    return questsFetchCurrent();
}
