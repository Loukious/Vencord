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

import { QUEST_ERROR_MESSAGES } from "@plugins/questCompleter/constants";
import { endQuest, isQuestRunning } from "@plugins/questCompleter/state";
import type { QuestCompletionContext } from "@plugins/questCompleter/types";
import { showToast, Toasts } from "@webpack/common";

function getQuestErrorMessage(context: QuestCompletionContext, error: unknown) {
    if (error instanceof Error && error.message) return error.message;

    return QUEST_ERROR_MESSAGES[context.taskName];
}

export function completeQuest(context: QuestCompletionContext) {
    if (!endQuest(context.quest.id)) return;

    context.showQuestNotification("Completed", "Quest finished!");
    console.log(`[Quest] ${context.questName} completed.`);
}

export function failQuest(context: QuestCompletionContext, error: unknown) {
    if (!endQuest(context.quest.id)) return;

    console.error(`[Quest] ${context.taskName} failed:`, error);
    showToast(getQuestErrorMessage(context, error), Toasts.Type.FAILURE);
}

export async function runQuestStep(context: QuestCompletionContext, step: () => Promise<void> | void) {
    if (!isQuestRunning(context.quest.id)) return;

    try {
        await step();
    } catch (error) {
        failQuest(context, error);
    }
}
