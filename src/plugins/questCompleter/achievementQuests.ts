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

import * as DataStore from "@api/DataStore";
import { type ActivityProtocol, fetchActivityProtocol } from "@plugins/questCompleter/activityProtocol";
import { completeQuest, failQuest, runQuestStep } from "@plugins/questCompleter/completion";
import { QUEST_WATCH_INTERVAL_MS } from "@plugins/questCompleter/constants";
import {
    fetchCurrentQuests,
    getLatestQuestProgress,
    getQuestById,
    getQuestProgress,
    isQuestExpired,
    isQuestUserStatusCompleted,
    sleep
} from "@plugins/questCompleter/quests";
import { isQuestRunning } from "@plugins/questCompleter/state";
import type { QuestCompletionContext } from "@plugins/questCompleter/types";
import { PluginNative } from "@utils/types";
import { waitFor } from "@webpack";
import { RestAPI, showToast } from "@webpack/common";

const Native = VencordNative.pluginHelpers?.QuestCompleter as PluginNative<typeof import("./native")>;

// Every embedded activity is served from its own {applicationId}.discordsays.com host
const activityProxyOrigin = (applicationId: string) => `https://${applicationId}.discordsays.com`;

// The Arise client drops progress attempts less than five seconds apart.
const ACHIEVEMENT_PROGRESS_INTERVAL_MS = 10 * 1000;

// How often the watcher refetches the current quests — the acf backend reports
// progress to Discord out of band, so the quest store only catches up on a refetch
const QUEST_REFETCH_INTERVAL_MS = 30 * 1000;

// Only reuse tokens with an explicit expiry, allowing a day for expiration.
const ACTIVITY_TOKEN_EXPIRY_MARGIN_MS = 24 * 60 * 60 * 1000;

// The OAuth consent modal lives in a lazily loaded chunk; give up on opening
// it if nothing has pulled that chunk in after a while
const OAUTH_MODAL_TIMEOUT_MS = 30 * 1000;

const ACTIVITY_OAUTH_SCOPES = ["identify"] as const;

const DATA_STORE_KEY = "questCompleter_activityAuth";

interface ActivityAuth {
    token: string;
    expiresAt: number;
}

async function getActivityAuthCache() {
    return await DataStore.get<Record<string, ActivityAuth>>(DATA_STORE_KEY) ?? {};
}

async function getCachedActivityAuth(applicationId: string) {
    const auth = (await getActivityAuthCache())[applicationId];
    return auth?.token && auth.expiresAt - ACTIVITY_TOKEN_EXPIRY_MARGIN_MS > Date.now() ? auth : null;
}

async function storeActivityAuth(applicationId: string, auth: ActivityAuth) {
    const cache = await getActivityAuthCache();
    cache[applicationId] = auth;
    await DataStore.set(DATA_STORE_KEY, cache);
}

function getTokenExpiry(token: string) {
    try {
        // The activity token is distinct from the Discord OAuth access_token.
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
    } catch {
        return 0;
    }
}

function extractCodeFromLocation(location: string | null | undefined) {
    if (!location) return null;

    try {
        return new URL(location).searchParams.get("code");
    } catch {
        return null;
    }
}

// A fresh stateless ticket is required for each activity instance.
async function mintActivityReferrer(applicationId: string): Promise<string> {
    let ticket: string | undefined;
    try {
        const response = await RestAPI.post({
            url: `/applications/${applicationId}/proxy-tickets`,
            body: { use_stateless_ticket: true }
        });
        ticket = response.body?.ticket;
    } catch (error: any) {
        if (error?.body?.code === 50165) {
            throw new Error("The activity is age-gated or delisted on this account");
        }
        throw new Error(error?.body?.message ?? "Discord did not return a proxy ticket");
    }

    if (!ticket) {
        throw new Error("Discord did not return a proxy ticket");
    }

    return `https://${applicationId}.discordsays.com/?instance_id=example-cl-instance&platform=desktop&discord_proxy_ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Mints an OAuth code through Discord's own API with no popup, exactly like
 * the client does for an embedded SDK authorize with prompt "none": fetch the
 * authorize props, and when the app is already authorized with all
 * disclosures acknowledged, post the authorize directly and read the code out
 * of the returned redirect location. Returns null when user consent would be
 * required — anything a silent grant cannot supply.
 */
async function getSilentAuthCode(applicationId: string): Promise<string | null> {
    const scope = encodeURIComponent(ACTIVITY_OAUTH_SCOPES.join(" "));
    const [props, disclosures] = await Promise.all([
        RestAPI.get({
            url: `/oauth2/authorize?client_id=${applicationId}&response_type=code&scope=${scope}&state=&integration_type=1`
        }),
        RestAPI.get({ url: `/applications/${applicationId}/disclosures` })
    ]);

    if (!props.body?.authorized || !disclosures.body?.all_acked) return null;

    const response = await RestAPI.post({
        url: `/oauth2/authorize?client_id=${applicationId}&response_type=code&scope=${scope}&state=`,
        body: {
            permissions: "0",
            authorize: true,
            integration_type: 1,
            // The no-channel sentinel context the client sends when the
            // authorize is not tied to a guild or channel
            location_context: { guild_id: "10000", channel_id: "10000", channel_type: 10000 }
        }
    });

    return extractCodeFromLocation(response.body?.location);
}

/**
 * Opens Discord's real OAuth consent popup for the activity's application and
 * resolves with the granted code. The popup handles disclosures and the
 * authorize button itself — the same one the activity flow shows. Its callback
 * hands us the redirect location the code lives in (returning true keeps
 * Discord from opening that location as a window), and the close callback
 * catches dismissals and failures, which never reach the main callback.
 */
function getConsentAuthCode(applicationId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let settled = false;

        const settle = (error: Error | null, code?: string) => {
            if (settled) return;
            settled = true;
            error ? reject(error) : resolve(code!);
        };

        // If the lazily loaded OAuth modal chunk never arrives, waitFor never
        // fires — give up instead of hanging the quest forever. Once settled
        // this is a harmless no-op.
        setTimeout(() => {
            settle(new Error("Discord's OAuth popup is unavailable — open the activity once, then try again"));
        }, OAUTH_MODAL_TIMEOUT_MS);

        waitFor("openOAuth2Modal", (mod: any) => {
            if (settled) return;

            mod.openOAuth2Modal(
                {
                    clientId: applicationId,
                    scopes: [...ACTIVITY_OAUTH_SCOPES],
                    responseType: "code",
                    state: "",
                    // 1 = USER_INSTALL, the integration type Discord's own
                    // embedded-activity authorize flow passes
                    integrationType: 1,
                    callback: (result: any) => {
                        const code = extractCodeFromLocation(result?.location);
                        settle(code ? null : new Error("Authorization did not return a code"), code ?? undefined);
                        return true;
                    }
                },
                // Fires on every modal close — a no-op once the callback above
                // has already settled the successful path
                () => settle(new Error("Authorization was canceled"))
            );
        });
    });
}

// Desktop requests use the native helper because the activity proxy can reject renderer CORS.
async function acfPost(applicationId: string, protocol: ActivityProtocol, path: string, body: any, authToken: string = "", questId?: string, referrer?: string) {
    const url = `${activityProxyOrigin(applicationId)}/.proxy/acf${path}`;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        // ACF authorization includes an empty X-Auth-Token.
        "X-Auth-Token": authToken,
        ...protocol.headers,
        ...(protocol.questIdHeader && questId ? { "X-Discord-Quest-ID": questId } : {}),
        ...(referrer ? { "Referer": referrer } : {})
    };

    if (Native != null) {
        const result = await Native.activityProxyPostNative(url, headers, body);
        if (!result.ok) {
            throw new Error(result.body?.message ?? `Activity proxy request failed (${result.status})`);
        }

        return result.body;
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10 * 1000)
        });
    } catch (error) {
        console.error("[Quest] Activity proxy request failed:", error);
        throw new Error("Failed to reach the activity proxy (the request may be blocked by CORS)");
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(payload?.message ?? `Activity proxy request failed (${response.status})`);
    }

    return payload;
}

// Resolve each activity's current Arise client before making authenticated requests.
export async function completeAchievementQuest(context: QuestCompletionContext) {
    const { quest, applicationId, runningQuest } = context;

    // The quest must be enrolled before any progress the activity backend
    // reports can be counted
    if (!getQuestById(quest.id)?.userStatus?.enrolledAt) {
        throw new Error("Quest enrollment is not confirmed yet — please try again");
    }

    const protocol = Native != null
        ? await Native.getActivityProtocolNative(applicationId)
        : await fetchActivityProtocol(applicationId, async url => {
            const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10 * 1000) });
            if (!response.ok) throw new Error(`Failed to load the activity client (${response.status})`);
            return response.text();
        });
    if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;

    let auth = await getCachedActivityAuth(applicationId);
    if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;
    let referrer: string;

    if (!auth) {
        // The proxy ticket and the code mint are independent — run both at once
        const [codeResult, referrerResult] = await Promise.allSettled([
            getSilentAuthCode(applicationId),
            mintActivityReferrer(applicationId)
        ]);
        if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;

        if (referrerResult.status === "rejected") {
            throw referrerResult.reason;
        }
        referrer = referrerResult.value;

        let code = codeResult.status === "fulfilled" ? codeResult.value : null;
        if (!code) {
            showToast({ text: "Accept the authorization popup to allow the activity..." });
            code = await getConsentAuthCode(applicationId);
            if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;
        }

        // Exchange the one-time code for the activity's own auth token
        const authorization = protocol.authorizationHasActivityId
            ? { code, activityId: applicationId }
            : { code };
        const exchange = await acfPost(applicationId, protocol, "/authorize", authorization, "", quest.id, referrer);
        if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;
        if (!exchange?.token) {
            throw new Error(exchange?.message ?? "The activity did not return an auth token");
        }

        auth = { token: exchange.token, expiresAt: getTokenExpiry(exchange.token) };
        await storeActivityAuth(applicationId, auth);
    } else {
        // The cached token is reusable, but the proxy ticket is short-lived —
        // mint a fresh referrer for this run's acf calls
        referrer = await mintActivityReferrer(applicationId);
    }

    const target = context.secondsNeeded;
    const startProgress = getLatestQuestProgress(context);

    // Objectives are posted one at a time as cumulative counts, mirroring how
    // the activity reports each one as it happens
    for (let progress = startProgress + 1; progress <= target; progress++) {
        if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;

        const body = protocol.progressHasQuestId ? { progress, quest_id: quest.id } : { progress };
        const payload = await acfPost(applicationId, protocol, "/quest/progress", body, auth.token, quest.id, referrer);
        if (payload?.status !== "ok") {
            throw new Error(payload?.message ?? "The activity rejected a progress update");
        }

        console.log(`[Quest] Posted activity objective: ${progress}/${target}`);
        if (progress < target) await sleep(ACHIEVEMENT_PROGRESS_INTERVAL_MS);
    }

    await fetchCurrentQuests();
    if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;

    let lastLoggedProgress = -1;
    let lastRefetchAt = Date.now();

    const watchForCompletion = () => {
        if (!isQuestRunning(quest.id) || runningQuest.cancelled) return;

        const current = getQuestById(quest.id);

        if (isQuestUserStatusCompleted(current?.userStatus)) {
            console.log("[Quest] Server confirmed activity completion.");
            completeQuest(context);
            return;
        }

        if (!current || isQuestExpired(current)) {
            failQuest(context, new Error("Quest expired or is no longer available"));
            return;
        }

        const progress = getQuestProgress(current, context.taskName);
        if (progress !== lastLoggedProgress) {
            console.log(`[Quest] Activity progress: ${progress}/${target}`);
            lastLoggedProgress = progress;
        }

        // Keep the store in sync with whatever the activity backend has
        // reported to Discord since the last look
        if (Date.now() - lastRefetchAt >= QUEST_REFETCH_INTERVAL_MS) {
            lastRefetchAt = Date.now();
            void fetchCurrentQuests().catch(error => console.error("[Quest] Failed to refetch quests:", error));
        }

        runningQuest.progressTimeout = setTimeout(() => {
            void runQuestStep(context, watchForCompletion);
        }, QUEST_WATCH_INTERVAL_MS);
    };

    watchForCompletion();
}
