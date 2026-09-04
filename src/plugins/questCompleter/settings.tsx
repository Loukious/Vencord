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

import { BaseText } from "@components/BaseText";
import { Span } from "@components/Span";
import { isApp } from "@plugins/questCompleter/constants";
import { stopQuest, useRunningQuests } from "@plugins/questCompleter/state";

export function QuestCompleterSettings() {
    const quests = useRunningQuests();

    return (
        <>
            {isApp ? (
                <BaseText size="lg" weight="bold">
                    The plugin should work properly because you are on the Desktop Client.
                </BaseText>
            ) : (
                <BaseText size="lg" weight="bold" style={{ color: "var(--text-danger)" }}>
                    Error: This plugin only works for non-video quests in the browser.
                </BaseText>
            )}
            <div style={{ marginTop: "10px" }}>
                <BaseText size="md" weight="bold">Currently running quests:</BaseText>
                {quests.map(quest => (
                    <div key={quest.questId} style={{ display: "flex", alignItems: "center", marginTop: "5px" }}>
                        <Span size="md">{quest.questName} ({quest.taskName})</Span>
                        <button
                            onClick={() => stopQuest(quest.questId)}
                            style={{ marginLeft: "10px", padding: "2px 5px" }}
                        >
                            Stop
                        </button>
                    </div>
                ))}
            </div>
        </>
    );
}
