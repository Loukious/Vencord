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

import { completeQuest, failQuest, runQuestStep } from "@plugins/questCompleter/completion";
import {
    FLUX_EVENTS,
    HEARTBEAT_FINAL_BUFFER_MS,
    HEARTBEAT_MAX_INTERVAL_MS,
    HEARTBEAT_STALLED_BEAT_LIMIT,
    QUEST_WATCH_INTERVAL_MS
} from "@plugins/questCompleter/constants";
import {
    ApplicationStreamingStore,
    fetchCurrentQuests,
    getLatestQuestProgress,
    getQuestById,
    getQuestProgress,
    isQuestCompleted,
    isQuestExpired,
    isQuestUserStatusCompleted,
    sendQuestHeartbeat
} from "@plugins/questCompleter/quests";
import { isQuestRunning } from "@plugins/questCompleter/state";
import type { QuestCompletionContext } from "@plugins/questCompleter/types";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher, RestAPI, VoiceStateStore } from "@webpack/common";

const RunningGameStore: any = findStoreLazy("RunningGameStore");

// Fake games that must survive native rebuilds of the running games list
const persistentFakeGames = new Set<any>();
let gameSurvivalInstalled = false;

/**
 * Keeps fake games alive when the native process observer rebuilds
 * RunningGameStore's games array. Every real game event (launch, exit) makes
 * the observer reassign that array from scratch and dispatch
 * RUNNING_GAMES_CHANGE — which would silently drop the fakes and make the
 * official heartbeat scheduler treat the spoofed game as closed (termination +
 * terminal heartbeat). Wrapping FluxDispatcher.dispatch re-inserts each fake
 * into the live array before any handler — including the scheduler's — sees
 * the action, so the spoofed session continues uninterrupted. The native
 * dispatch passes the live array itself as `games`, so the payload stays
 * consistent with the store for free, and the fake never appears in
 * added/removed (those are diffed from the observer's pid map, which never
 * knew about it).
 *
 * The wrapper is installed once and never removed: restoring the saved
 * original could clobber another plugin's later wrapper of the same method,
 * and with an empty set it costs one property check per dispatch.
 *
 * When the real quest game runs alongside the fake, both entries share the
 * application id and the scheduler's matching is last-wins — since the fake is
 * always re-appended at the end of a rebuild, the spoof keeps driving the
 * heartbeats even then.
 */
function installGameSurvival() {
    if (gameSurvivalInstalled) return;
    gameSurvivalInstalled = true;

    const realDispatch = FluxDispatcher.dispatch;
    (FluxDispatcher as any).dispatch = function (action: any) {
        if (persistentFakeGames.size > 0 && action?.type === FLUX_EVENTS.RUNNING_GAMES) {
            const games: any[] = RunningGameStore.getRunningGames();

            for (const fakeGame of persistentFakeGames) {
                // Intentional removals carry the fake in `removed` — the quest
                // is ending, do not resurrect it
                if (action.removed?.includes(fakeGame)) continue;

                if (!games.includes(fakeGame)) {
                    games.push(fakeGame);
                }
            }
        }

        return realDispatch.call(this, action);
    };
}

// Mirrors the official calculateHeartbeatDurationMs: one beat per minute, or the
// remaining time plus a 1s buffer once the quest is under a minute from done
function calculateHeartbeatDurationMs(context: QuestCompletionContext, progressSeconds: number) {
    const remainingMs = Math.max(0, (context.secondsNeeded - progressSeconds) * 1000);
    return remainingMs <= HEARTBEAT_MAX_INTERVAL_MS
        ? remainingMs + HEARTBEAT_FINAL_BUFFER_MS
        : HEARTBEAT_MAX_INTERVAL_MS;
}

/**
 * Removes the fake game from RunningGameStore's live array and dispatches the
 * change. The store's RUNNING_GAMES_CHANGE handler ignores the action payload,
 * so splicing the array is what actually removes the game; the dispatch makes
 * every other listener (including the official heartbeat scheduler) react to it.
 * Matching is done by identity so concurrent fake/real games can never be
 * confused with each other.
 */
function removeFakeGame(fakeGame: any) {
    persistentFakeGames.delete(fakeGame);

    const games: any[] = RunningGameStore.getRunningGames();
    const index = games.indexOf(fakeGame);
    if (index !== -1) games.splice(index, 1);

    FluxDispatcher.dispatch({
        type: FLUX_EVENTS.RUNNING_GAMES,
        added: [],
        removed: [fakeGame],
        games: [...games]
    });
}

function scheduleNextHeartbeat(context: QuestCompletionContext, beat: () => Promise<void>, progressSeconds: number) {
    context.runningQuest.progressTimeout = setTimeout(() => {
        void runQuestStep(context, beat);
    }, calculateHeartbeatDurationMs(context, progressSeconds));
}

/**
 * Heartbeat loop for the tasks the plugin still drives itself (activity quests).
 * Scheduling uses only server-confirmed progress from the quest store, exactly
 * like the official scheduler — there is no local progress clock. The terminal
 * heartbeat is never sent from here: officially it only fires when the activity
 * ends with the quest still unfinished, which maps to the user stopping the
 * quest (see shouldSendTerminalHeartbeat).
 */
export async function runHeartbeatQuest(context: QuestCompletionContext, sendHeartbeat: () => Promise<any>) {
    const { quest } = context;
    let stalledBeats = 0;

    const beat = async () => {
        if (!isQuestRunning(quest.id)) return;

        await sendHeartbeat();
        if (!isQuestRunning(quest.id)) return;

        if (isQuestCompleted(context)) {
            completeQuest(context);
            return;
        }

        const serverProgress = getLatestQuestProgress(context);

        // Near the target the official cadence collapses to ~1s per beat while
        // the server confirms the remaining seconds; bail out if it never does
        if (serverProgress >= context.secondsNeeded) {
            if (++stalledBeats >= HEARTBEAT_STALLED_BEAT_LIMIT) {
                failQuest(context, new Error("Server is not counting quest heartbeats"));
                return;
            }
        } else {
            stalledBeats = 0;
        }

        scheduleNextHeartbeat(context, beat, serverProgress);
    };

    await beat();
}

/**
 * PLAY_ON_DESKTOP spoof, driven the way a real game launch is: the fake game is
 * dispatched into RunningGameStore and Discord's own QuestProgressManager takes
 * over. It sends every heartbeat (including the official short executable_path
 * form), computes the cadence from server-confirmed progress, and fires the
 * terminal heartbeat when the game entry is removed. The plugin itself never
 * beats — it only watches the quest store for completion. Real games launching
 * or exiting mid-spoof do not interrupt the session (see installGameSurvival),
 * not even the quest's own game.
 */
export async function completeDesktopQuest(context: QuestCompletionContext) {
    const { quest, applicationId, applicationName, runningQuest } = context;
    const res = await RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` });

    if (!isQuestRunning(quest.id)) return;

    const appData = res.body[0];
    if (!appData) throw new Error("Failed to load application data");

    let exeName = applicationName.toLowerCase().replace(/\s+/g, "") + ".exe";
    if (appData.executables && Array.isArray(appData.executables)) {
        const executable = appData.executables.find(x => x.os === "win32");
        if (executable?.name) exeName = executable.name.replace(">", "");
    }

    const exePath = `c:/program files (x86)/steam/steamapps/common/${appData.name.toLowerCase()}/${exeName.toLowerCase()}`;
    const pid = Math.floor(Math.random() * 30000) + 1000;

    const fakeGame = {
        // Real detected games carry the process command line; a bare quoted
        // executable path is what a no-argument launch looks like
        cmdLine: `"${exePath}"`,
        distributor: appData.distributor ?? "steam",
        elevated: false,
        exeName: exeName.toLowerCase(),
        exePath,
        // Left undefined on purpose: the fingerprint is a native hash of the
        // real executable and cannot be fabricated. Clients with fingerprint
        // collection disabled send the same omission.
        executableFingerprint: undefined,
        // BORDERLESS_FULLSCREEN — the most common launch state for modern games
        // (UNKNOWN=0, WINDOWED=1, MAXIMIZED=2, BORDERLESS_FULLSCREEN=3, FULLSCREEN=4)
        fullscreenType: 3,
        gameMetadata: undefined,
        hidden: false,
        id: applicationId,
        isLauncher: false,
        // Real entries carry focus timestamps (the recent-games list sorts by it)
        lastFocused: Date.now(),
        name: appData.name,
        nativeProcessObserverId: Math.floor(Math.random() * 30000) + 1000,
        origGameName: appData.name,
        pid,
        pidPath: [
            Math.floor(Math.random() * 30000) + 1000,
            Math.floor(Math.random() * 30000) + 1000,
            Math.floor(Math.random() * 30000) + 1000,
            pid
        ],
        processName: appData.name,
        sandboxed: false,
        sku: appData.primary_sku_id ?? undefined,
        start: Date.now(),
        // Native reports the window handle as a decimal string (or null)
        windowHandle: String(Math.floor(Math.random() * 9000000) + 1000000),
    };

    runningQuest.gameInstance = fakeGame;
    runningQuest.cleanup = () => {
        // Remove the game from the store's live games array, then dispatch the
        // change. The official scheduler reacts by terminating the quest and,
        // while it is still enrolled and unfinished, sending the terminal
        // heartbeat — exactly what happens when a real game exits
        removeFakeGame(fakeGame);
    };

    // The official scheduler only beats for quests whose enrolledAt has reached
    // the quest store, so make sure enrollment is visible before "launching"
    if (!getQuestById(quest.id)?.userStatus?.enrolledAt) {
        throw new Error("Quest enrollment is not confirmed yet — please try again");
    }

    console.log(`[Quest] Launching fake game "${appData.name}" — Discord's own scheduler will send the heartbeats.`);

    // Register the fake for survival across native rebuilds of the games list
    // (real games launching/exiting), then insert it into RunningGameStore's
    // live array. The store's RUNNING_GAMES_CHANGE handler ignores the action
    // payload and only reads this internal array (getRunningGames returns it by
    // reference), and the official heartbeat scheduler matches quests against
    // getRunningGames() — so the fake has to live there. The dispatch then
    // triggers the scheduler's sync, which starts the official heartbeats.
    persistentFakeGames.add(fakeGame);
    installGameSurvival();

    const games: any[] = RunningGameStore.getRunningGames();
    games.push(fakeGame);
    FluxDispatcher.dispatch({
        type: FLUX_EVENTS.RUNNING_GAMES,
        added: [fakeGame],
        removed: [],
        games: [...games]
    });

    let lastLoggedProgress = -1;

    const watchForCompletion = () => {
        if (!isQuestRunning(quest.id)) return;

        // The dispatch wrapper keeps the fake alive across native rebuilds, so
        // the session only ends when no game with the quest's application id
        // is running. If it vanished anyway (wrapper bypassed), re-insert the
        // fake: the dispatch re-triggers the scheduler's sync and its
        // heartbeats resume.
        const games: any[] = RunningGameStore.getRunningGames();
        if (!games.some(g => g.id === applicationId)) {
            console.warn("[Quest] Fake game was dropped from the store — re-inserting it.");
            games.push(fakeGame);
            FluxDispatcher.dispatch({
                type: FLUX_EVENTS.RUNNING_GAMES,
                added: [fakeGame],
                removed: [],
                games: [...games]
            });
        }

        const current = getQuestById(quest.id);

        if (isQuestUserStatusCompleted(current?.userStatus)) {
            console.log("[Quest] Server confirmed game completion.");
            completeQuest(context);
            return;
        }

        if (!current || isQuestExpired(current)) {
            failQuest(context, new Error("Quest expired or is no longer available"));
            return;
        }

        const progress = getQuestProgress(current, context.taskName);
        if (progress !== lastLoggedProgress) {
            console.log(`[Quest] Game progress: ${progress}/${context.secondsNeeded}s`);
            lastLoggedProgress = progress;
        }

        runningQuest.progressTimeout = setTimeout(() => {
            void runQuestStep(context, watchForCompletion);
        }, QUEST_WATCH_INTERVAL_MS);
    };

    watchForCompletion();
}

/**
 * STREAM_ON_DESKTOP spoof, driven like a real stream: the streamer metadata
 * store is patched so Discord's own QuestProgressManager sees the active stream
 * as the quest's application, and a current-quests refetch triggers the
 * scheduler's sync. From then on the official scheduler sends every heartbeat
 * with the real stream key, and it stops beating (sending the terminal
 * heartbeat) once the stream ends or the channel empties. The plugin itself
 * never beats — it only watches the quest store.
 */
export async function completeStreamQuest(context: QuestCompletionContext) {
    const { quest, applicationId, runningQuest } = context;
    const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

    // Make the official scheduler match the active stream to the quest
    ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
        id: applicationId,
        pid: Math.floor(Math.random() * 30000) + 1000,
        sourceName: null
    });

    runningQuest.cleanup = () => {
        // Restoring the real metadata makes the quest stop matching, which the
        // scheduler notices on its next beat (or the next voice event) — it then
        // terminates the quest and, while it is still enrolled and unfinished,
        // sends the terminal heartbeat, exactly like ending the stream
        ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
    };

    // The official scheduler only beats for quests whose enrolledAt has reached
    // the quest store, so make sure enrollment is visible before spoofing
    if (!getQuestById(quest.id)?.userStatus?.enrolledAt) {
        throw new Error("Quest enrollment is not confirmed yet — please try again");
    }

    console.log(`[Quest] Spoofing stream metadata for "${context.applicationName}" — Discord's own scheduler will send the heartbeats.`);

    // Officially the scheduler syncs stream quests on voice events; refetching
    // the current quests through Discord's own action triggers the same sync
    // immediately
    await fetchCurrentQuests();
    if (!isQuestRunning(quest.id)) return;

    let lastLoggedProgress = -1;

    const watchForCompletion = () => {
        if (!isQuestRunning(quest.id)) return;

        // Mirror the official "actively progressing" conditions: an active
        // stream with at least one other user in the channel
        const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
        if (stream == null || (VoiceStateStore as any).countVoiceStatesForChannel(stream.channelId) < 2) {
            failQuest(context, new Error("Stream ended before the quest completed"));
            return;
        }

        const current = getQuestById(quest.id);

        if (isQuestUserStatusCompleted(current?.userStatus)) {
            console.log("[Quest] Server confirmed stream completion.");
            completeQuest(context);
            return;
        }

        if (!current || isQuestExpired(current)) {
            failQuest(context, new Error("Quest expired or is no longer available"));
            return;
        }

        const progress = getQuestProgress(current, context.taskName);
        if (progress !== lastLoggedProgress) {
            console.log(`[Quest] Stream progress: ${progress}/${context.secondsNeeded}s`);
            lastLoggedProgress = progress;
        }

        runningQuest.progressTimeout = setTimeout(() => {
            void runQuestStep(context, watchForCompletion);
        }, QUEST_WATCH_INTERVAL_MS);
    };

    watchForCompletion();
}

export async function completeActivityQuest(context: QuestCompletionContext) {
    const { quest, applicationId } = context;

    const sendHeartbeat = () => sendQuestHeartbeat({ questId: quest.id, applicationId, terminal: false });

    await runHeartbeatQuest(context, sendHeartbeat);
}
