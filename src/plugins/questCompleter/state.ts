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

import type { RunningQuest } from "@plugins/questCompleter/types";
import { showToast, useEffect, useState } from "@webpack/common";

export const runningQuests = new Map<string, RunningQuest>();
const runningQuestListeners = new Set<() => void>();

function getRunningQuestsSnapshot() {
    return Array.from(runningQuests.values());
}

export function emitRunningQuestsChange() {
    for (const listener of runningQuestListeners) listener();
}

export function useRunningQuests() {
    const [quests, setQuests] = useState<RunningQuest[]>(getRunningQuestsSnapshot);

    useEffect(() => {
        const listener = () => setQuests(getRunningQuestsSnapshot());
        runningQuestListeners.add(listener);

        return () => void runningQuestListeners.delete(listener);
    }, []);

    return quests;
}

export function isQuestRunning(questId: string) {
    return runningQuests.has(questId) && !runningQuests.get(questId)?.cancelled;
}

export function endQuest(questId: string) {
    const questData = runningQuests.get(questId);
    if (!questData) return null;

    console.log("[Quest] Ending quest:", questData.questName);
    questData.cancelled = true;

    if (questData.progressTimeout) {
        clearTimeout(questData.progressTimeout);
        console.log("[Quest] Cleared progress timeout");
    }

    if (questData.cleanup) {
        console.log("[Quest] Executing cleanup");
        try {
            questData.cleanup();
        } catch (error) {
            console.error("[Quest] Cleanup failed:", error);
        }
    }

    runningQuests.delete(questId);
    emitRunningQuestsChange();
    console.log("[Quest] Removed from tracking");

    return questData;
}

export function stopQuest(questId: string) {
    const questData = endQuest(questId);
    if (!questData) return;

    showToast({ text: `Stopped quest: ${questData.questName}` });
}
