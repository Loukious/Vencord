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
import { BaseText } from "@components/BaseText";
import { Span } from "@components/Span";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByCode, findByProps, findStoreLazy } from "@webpack";
import { FluxDispatcher, RestAPI, showToast, Toasts, useEffect, useState } from "@webpack/common";

const FLUX_EVENTS = {
    RUNNING_GAMES: "RUNNING_GAMES_CHANGE"
} as const;

const ApplicationStreamingStore = findStoreLazy("ApplicationStreamingStore");
const questAssetsBaseUrl = "https://cdn.discordapp.com/quests/";
const QUEST_TASKS = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"] as const;
const HEARTBEAT_MAX_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_FINAL_BUFFER_MS = 1000;
const VIDEO_PROGRESS_MIN_CHECKPOINTS = 2;
const VIDEO_PROGRESS_MAX_CHECKPOINTS = 4;

type QuestTaskName = typeof QUEST_TASKS[number];

const HEARTBEAT_QUEST_TASKS = new Set<QuestTaskName>(["PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"]);

const QUEST_ERROR_MESSAGES: Record<QuestTaskName, string> = {
    WATCH_VIDEO: "Failed to update video progress",
    WATCH_VIDEO_ON_MOBILE: "Failed to update video progress",
    PLAY_ON_DESKTOP: "Failed to update game progress",
    STREAM_ON_DESKTOP: "Failed to update stream progress",
    PLAY_ACTIVITY: "Failed to update activity progress"
};

interface RunningQuest {
    cleanup?: () => void;
    questId: string;
    applicationName: string;
    questName: string;
    taskName: QuestTaskName;
    gameInstance?: any;
    progressTimeout?: ReturnType<typeof setTimeout>;
    cancelled?: boolean;
    terminalHeartbeatSent?: boolean;
}

interface QuestCompletionContext {
    quest: any;
    currentStream: any;
    runningQuest: RunningQuest;
    applicationId: string;
    applicationName: string;
    questName: string;
    secondsNeeded: number;
    taskName: QuestTaskName;
    showQuestNotification(title: string, body: string): void;
}

interface QuestHeartbeatOptions {
    questId: string;
    streamKey?: string;
    applicationId?: string;
    terminal?: boolean;
    executablePath?: string;
    executableFingerprint?: string;
}

const runningQuests = new Map<string, RunningQuest>();
const runningQuestListeners = new Set<() => void>();
const isApp = navigator.userAgent.includes("Electron/");
let questsHeartbeat: ((options: QuestHeartbeatOptions) => Promise<any>) | undefined;

function getQuestById(questId: string) {
    const QuestsStore = findByProps("getQuest");
    return QuestsStore.quests.get(questId);
}

function encodeStreamKey(e): string {
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

function getRunningQuestsSnapshot() {
    return Array.from(runningQuests.values());
}

function emitRunningQuestsChange() {
    for (const listener of runningQuestListeners) listener();
}

function useRunningQuests() {
    const [quests, setQuests] = useState<RunningQuest[]>(getRunningQuestsSnapshot);

    useEffect(() => {
        const listener = () => setQuests(getRunningQuestsSnapshot());
        runningQuestListeners.add(listener);

        return () => void runningQuestListeners.delete(listener);
    }, []);

    return quests;
}

function isQuestRunning(questId: string) {
    return runningQuests.has(questId) && !runningQuests.get(questId)?.cancelled;
}

function isQuestUserStatusCompleted(userStatus: any) {
    return userStatus?.completedAt != null || userStatus?.completed_at != null;
}

function shouldSendTerminalHeartbeat(runningQuest: RunningQuest) {
    if (runningQuest.terminalHeartbeatSent || !HEARTBEAT_QUEST_TASKS.has(runningQuest.taskName)) return false;

    const quest = getQuestById(runningQuest.questId);
    return quest?.userStatus?.enrolledAt != null && !isQuestUserStatusCompleted(quest.userStatus);
}

function sendTerminalHeartbeatForRunningQuest(runningQuest: RunningQuest) {
    if (!shouldSendTerminalHeartbeat(runningQuest)) return false;

    runningQuest.terminalHeartbeatSent = true;
    void sendQuestHeartbeat({ questId: runningQuest.questId, terminal: true })
        .catch(error => console.error("[Quest] Failed to send terminal heartbeat:", error));

    return true;
}

function endQuest(questId: string) {
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

    sendTerminalHeartbeatForRunningQuest(questData);

    runningQuests.delete(questId);
    emitRunningQuestsChange();
    console.log("[Quest] Removed from tracking");

    return questData;
}

function stopQuest(questId: string) {
    const questData = endQuest(questId);
    if (!questData) return;

    showToast(`Stopped quest: ${questData.questName}`, Toasts.Type.MESSAGE);
}

function getQuestImageConfig(questId: string) {
    const quest = getQuestById(questId);
    return {
        icon: `${questAssetsBaseUrl}${questId}/dark/${quest.config.assets.logotype}`,
        image: `${questAssetsBaseUrl}${questId}/${quest.config.assets.hero}`
    };
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getQuestProgress(quest: any, taskName: QuestTaskName) {
    return quest.config.configVersion === 1
        ? quest.userStatus?.streamProgressSeconds ?? 0
        : quest.userStatus?.progress?.[taskName]?.value ?? 0;
}

function getTaskApplication(quest: any, taskName: QuestTaskName) {
    return quest.config.taskConfigV2.tasks[taskName]?.applications?.[0] ?? quest.config.application;
}

function sendQuestHeartbeat(options: QuestHeartbeatOptions) {
    questsHeartbeat ??= findByCode("QUESTS_HEARTBEAT");
    if (!questsHeartbeat) throw new Error("Failed to find quest heartbeat action");

    return questsHeartbeat(options);
}

function getLatestQuestProgress(context: QuestCompletionContext, fallbackProgress = 0) {
    const quest = getQuestById(context.quest.id) ?? context.quest;
    return Math.max(getQuestProgress(quest, context.taskName), fallbackProgress);
}

function getHeartbeatResponseStatus(response: any) {
    return response?.body?.userStatus ?? response?.body?.user_status ?? response?.body;
}

function getHeartbeatResponseProgress(context: QuestCompletionContext, response: any) {
    const status = getHeartbeatResponseStatus(response);
    return status?.progress?.[context.taskName]?.value
        ?? status?.streamProgressSeconds
        ?? status?.stream_progress_seconds
        ?? 0;
}

function isHeartbeatCompleted(response: any) {
    const status = getHeartbeatResponseStatus(response);
    return isQuestUserStatusCompleted(status);
}

function isQuestCompleted(context: QuestCompletionContext, response?: any) {
    if (response && isHeartbeatCompleted(response)) return true;

    const quest = getQuestById(context.quest.id);
    return isQuestUserStatusCompleted(quest?.userStatus);
}

async function sendTerminalHeartbeatForContext(context: QuestCompletionContext) {
    if (!shouldSendTerminalHeartbeat(context.runningQuest)) return false;

    context.runningQuest.terminalHeartbeatSent = true;
    await sendQuestHeartbeat({ questId: context.quest.id, terminal: true });

    return true;
}

function calculateHeartbeatDurationMs(context: QuestCompletionContext, progressSeconds = getLatestQuestProgress(context)) {
    const remainingMs = Math.max(0, (context.secondsNeeded - progressSeconds) * 1000);
    return remainingMs <= HEARTBEAT_MAX_INTERVAL_MS
        ? remainingMs + HEARTBEAT_FINAL_BUFFER_MS
        : HEARTBEAT_MAX_INTERVAL_MS;
}

function getRandomInteger(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateVideoProgressDurationMs(context: QuestCompletionContext, progressSeconds: number, checkpointIntervalMs: number) {
    const remainingMs = Math.max(0, (context.secondsNeeded - progressSeconds) * 1000);
    return Math.min(checkpointIntervalMs, remainingMs + HEARTBEAT_FINAL_BUFFER_MS);
}

function getQuestErrorMessage(context: QuestCompletionContext, error: unknown) {
    if (error instanceof Error && error.message) return error.message;

    return QUEST_ERROR_MESSAGES[context.taskName];
}

function completeQuest(context: QuestCompletionContext) {
    if (!endQuest(context.quest.id)) return;

    context.showQuestNotification("Completed", "Quest finished!");
    console.log(`[Quest] ${context.questName} completed.`);
}

function failQuest(context: QuestCompletionContext, error: unknown) {
    if (!endQuest(context.quest.id)) return;

    console.error(`[Quest] ${context.taskName} failed:`, error);
    showToast(getQuestErrorMessage(context, error), Toasts.Type.FAILURE);
}

async function runQuestStep(context: QuestCompletionContext, step: () => Promise<void> | void) {
    if (!isQuestRunning(context.quest.id)) return;

    try {
        await step();
    } catch (error) {
        failQuest(context, error);
    }
}

function scheduleNextHeartbeat(context: QuestCompletionContext, beat: () => Promise<void>, progressSeconds: number) {
    context.runningQuest.progressTimeout = setTimeout(() => {
        void runQuestStep(context, beat);
    }, calculateHeartbeatDurationMs(context, progressSeconds));
}

function scheduleNextVideoProgress(
    context: QuestCompletionContext,
    saveProgress: () => Promise<void>,
    progressSeconds: number,
    checkpointIntervalMs: number
) {
    context.runningQuest.progressTimeout = setTimeout(() => {
        void runQuestStep(context, saveProgress);
    }, calculateVideoProgressDurationMs(context, progressSeconds, checkpointIntervalMs));
}

async function runHeartbeatQuest(context: QuestCompletionContext, sendHeartbeat: () => Promise<any>, getLocalProgress = () => 0) {
    const beat = async () => {
        if (!isQuestRunning(context.quest.id)) return;

        const response = await sendHeartbeat();
        if (!isQuestRunning(context.quest.id)) return;

        const serverProgress = Math.max(
            getHeartbeatResponseProgress(context, response),
            getLatestQuestProgress(context)
        );
        const localProgress = getLocalProgress();
        const progress = Math.max(localProgress, serverProgress);

        if (isQuestCompleted(context, response)) {
            completeQuest(context);
            return;
        }

        if (progress >= context.secondsNeeded && await sendTerminalHeartbeatForContext(context)) {
            if (!isQuestRunning(context.quest.id)) return;

            if (isQuestCompleted(context)) {
                completeQuest(context);
                return;
            }
        }

        scheduleNextHeartbeat(context, beat, context.runningQuest.terminalHeartbeatSent ? serverProgress : progress);
    };

    await beat();
}

async function completeVideoQuest(context: QuestCompletionContext) {
    const { quest, questName, secondsNeeded, taskName } = context;
    const progressAtStart = getQuestProgress(quest, taskName);
    const startTime = Date.now();
    const checkpointCount = getRandomInteger(VIDEO_PROGRESS_MIN_CHECKPOINTS, VIDEO_PROGRESS_MAX_CHECKPOINTS);
    const remainingMs = Math.max(0, (secondsNeeded - progressAtStart) * 1000);
    const checkpointIntervalMs = Math.ceil(remainingMs / checkpointCount);
    let lastSubmittedProgress = progressAtStart;

    console.log(`[Quest] Starting ${taskName}: ${questName} at ${progressAtStart}/${secondsNeeded}s with ${checkpointCount} checkpoints`);

    const getCurrentProgress = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        return Math.min(progressAtStart + elapsed, secondsNeeded);
    };

    const saveProgress = async () => {
        if (!isQuestRunning(quest.id)) return;

        const timestamp = Math.max(getCurrentProgress(), lastSubmittedProgress);
        if (timestamp <= lastSubmittedProgress && timestamp < secondsNeeded) {
            scheduleNextVideoProgress(context, saveProgress, timestamp, checkpointIntervalMs);
            return;
        }

        const response = await RestAPI.post({
            url: `/quests/${quest.id}/video-progress`,
            body: { timestamp }
        });

        if (!isQuestRunning(quest.id)) return;

        lastSubmittedProgress = timestamp;

        if (isQuestCompleted(context, response)) {
            console.log("[Quest] Server confirmed video completion.");
            completeQuest(context);
            return;
        }

        console.log(`[Quest] Saved video progress at ${Math.floor(timestamp)}/${secondsNeeded}s.`);
        scheduleNextVideoProgress(context, saveProgress, timestamp, checkpointIntervalMs);
    };

    scheduleNextVideoProgress(context, saveProgress, progressAtStart, checkpointIntervalMs);
}

async function completeDesktopQuest(context: QuestCompletionContext) {
    const { quest, applicationId, applicationName, secondsNeeded, runningQuest } = context;
    const RunningGameStore = findStoreLazy("RunningGameStore");
    const res = await RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` });

    if (!isQuestRunning(quest.id)) return;

    const appData = res.body[0];
    if (!appData) throw new Error("Failed to load application data");

    let exeName = applicationName.toLowerCase().replace(/\s+/g, "") + ".exe";
    if (appData.executables && Array.isArray(appData.executables)) {
        const executable = appData.executables.find(x => x.os === "win32");
        if (executable?.name) exeName = executable.name.replace(">", "");
    }

    const pid = Math.floor(Math.random() * 30000) + 1000;
    const parentPid1 = Math.floor(Math.random() * 30000) + 1000;
    const parentPid2 = Math.floor(Math.random() * 30000) + 1000;
    const parentPid3 = Math.floor(Math.random() * 30000) + 1000;

    const fakeGame = {
        cmdLine: "",
        distributor: appData.distributor ?? "steam",
        elevated: false,
        exeName: exeName.toLowerCase(),
        exePath: `c:/program files (x86)/steam/steamapps/common/${appData.name.toLowerCase()}/${exeName.toLowerCase()}`,
        executableFingerprint: undefined,
        fullscreenType: 1,
        gameMetadata: undefined,
        hidden: false,
        id: applicationId,
        isLauncher: false,
        lastFocused: 0,
        name: appData.name,
        nativeProcessObserverId: Math.floor(Math.random() * 30000) + 1000,
        origGameName: appData.name,
        pid,
        pidPath: [parentPid1, parentPid2, parentPid3, pid],
        processName: appData.name,
        sandboxed: false,
        sku: appData.primary_sku_id ?? undefined,
        start: Date.now(),
        windowHandle: String(Math.floor(Math.random() * 9000000) + 1000000),
    };

    runningQuest.gameInstance = fakeGame;
    runningQuest.cleanup = () => {
        FluxDispatcher.dispatch({
            type: FLUX_EVENTS.RUNNING_GAMES,
            added: [],
            removed: [fakeGame],
            games: RunningGameStore.getRunningGames().filter(g => g.pid !== fakeGame.pid)
        });
    };

    FluxDispatcher.dispatch({
        type: FLUX_EVENTS.RUNNING_GAMES,
        added: [fakeGame],
        removed: [],
        games: [...RunningGameStore.getRunningGames(), fakeGame]
    });

    const progressAtStart = getQuestProgress(quest, context.taskName);
    const startTime = Date.now();

    const getCurrentProgress = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        return Math.max(
            getLatestQuestProgress(context),
            Math.min(progressAtStart + elapsed, secondsNeeded)
        );
    };

    const sendHeartbeat = () => sendQuestHeartbeat({
        questId: quest.id,
        applicationId,
        executablePath: fakeGame.exePath,
        executableFingerprint: fakeGame.executableFingerprint,
        terminal: false
    });

    await runHeartbeatQuest(context, sendHeartbeat, getCurrentProgress);
}

async function completeStreamQuest(context: QuestCompletionContext) {
    const { quest, applicationId, currentStream, secondsNeeded, runningQuest } = context;
    const pid = Math.floor(Math.random() * 30000) + 1000;
    const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

    ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
        id: applicationId,
        pid,
        sourceName: null
    });

    runningQuest.cleanup = () => {
        ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
    };

    const progressAtStart = getQuestProgress(quest, context.taskName);
    const startTime = Date.now();

    const sendHeartbeat = () => sendQuestHeartbeat({
        questId: quest.id,
        streamKey: encodeStreamKey(currentStream),
        applicationId,
        terminal: false
    });

    const getCurrentProgress = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        return Math.min(progressAtStart + elapsed, secondsNeeded);
    };

    await runHeartbeatQuest(context, sendHeartbeat, getCurrentProgress);
}

async function completeActivityQuest(context: QuestCompletionContext) {
    const { quest, applicationId, secondsNeeded } = context;
    const progressAtStart = getQuestProgress(quest, context.taskName);
    const startTime = Date.now();

    const sendHeartbeat = () => sendQuestHeartbeat({ questId: quest.id, applicationId, terminal: false });

    const getCurrentProgress = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        return Math.min(progressAtStart + elapsed, secondsNeeded);
    };

    await runHeartbeatQuest(context, sendHeartbeat, getCurrentProgress);
}

const questCompleters: Record<QuestTaskName, (context: QuestCompletionContext) => Promise<void> | void> = {
    WATCH_VIDEO: completeVideoQuest,
    WATCH_VIDEO_ON_MOBILE: completeVideoQuest,
    PLAY_ON_DESKTOP: completeDesktopQuest,
    STREAM_ON_DESKTOP: completeStreamQuest,
    PLAY_ACTIVITY: completeActivityQuest
};

function QuestCompleterSettings() {
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

export default definePlugin({
    name: "QuestCompleter",
    description: "Auto complete quests without any requirements.",
    authors: [Devs.Loukious],
    patches: [
        {
            find: 'id:"share-link"',
            replacement: {
                match: /questId:(\w+)\.quest\.id(.*?)(\(0,(\w{1,3})\.(\w{1,3})\)\((\w{1,3})\.(\w{1,3}),\{id:"share-link"[^}]+}\}[^)]*\))/,
                replace: 'questId:$1.quest.id$2$3,(0,$4.$5)($6.$7,{id:"Auto-complete",label:"Auto Complete",action:()=>{$self.openCompleteQuest($1.quest.id);}})'
            }
        }
    ],

    settingsAboutComponent: QuestCompleterSettings,

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
            const res = await RestAPI.post({
                url: `/quests/${quest.id}/enroll`,
                body: {
                    location: 11,
                    is_targeted: false
                }
            });
            if (res.status !== 200) {
                if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
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

                const viewerIds = ApplicationStreamingStore.getViewerIds(encodeStreamKey(currentStream));
                if (!viewerIds?.length) {
                    showToast("You need at least one viewer in your stream!");
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
        const applicationId = taskApplication.id;
        const applicationName = taskApplication.name ?? quest.config.application.name;
        const { questName } = quest.config.messages;
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
