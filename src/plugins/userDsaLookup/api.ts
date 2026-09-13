/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

const API_BASE = "https://dsa.discord.food/api";

// https://dsa.discord.food/docs — one action from Discord's EU Digital Services
// Act transparency reports. Nullability taken from the documented response
// format; everything except uuid/type/parsedId can be absent in practice
export interface DsaAction {
    uuid: string;
    type: string;
    parsedId: string;
    decisionVisibility: string[] | null;
    decisionVisibilityOther: string | null;
    endDateVisibilityRestriction: string | null;
    decisionMonetary: string | null;
    decisionMonetaryOther: string | null;
    endDateMonetaryRestriction: string | null;
    decisionProvision: string | null;
    endDateServiceRestriction: string | null;
    decisionAccount: string | null;
    endDateAccountRestriction: string | null;
    accountType: string | null;
    decisionGround: string;
    decisionGroundReferenceUrl: string | null;
    illegalContentLegalGround: string | null;
    illegalContentExplanation: string | null;
    incompatibleContentGround: string | null;
    incompatibleContentExplanation: string | null;
    incompatibleContentIllegal: boolean | null;
    category: string;
    categoryAddition: string[] | null;
    categorySpecification: string[] | null;
    categorySpecificationOther: string | null;
    contentType: string[];
    contentTypeOther: string | null;
    contentLanguage: string | null;
    contentDate: string;
    contentIdEan: string | null;
    territorialScope: string[] | null;
    applicationDate: string;
    decisionFacts: string;
    sourceType: string;
    sourceIdentity: string | null;
    automatedDetection: boolean;
    automatedDecision: string;
    platformName: string;
    platformUid: string;
    createdAt: string;
}

export interface DsaSearchResult {
    actions: DsaAction[];
    pagination: {
        // the API returns this as a string despite the docs claiming number
        total?: number | string;
        limit: number;
        offset: number;
        hasMore: boolean;
        nextOffset?: number;
        prevOffset?: number;
        totalPages?: number;
        currentPage?: number;
        comment?: string;
    };
}

/**
 * dsa.discord.food gates /search behind a Cloudflare Turnstile per fresh
 * session. The siteKey is domain-locked to dsa.discord.food, so it cannot be
 * solved from inside Discord's renderer — instead the native side opens the
 * site in a popup on Discord's session, and the cookie it earns unblocks the
 * API (see native.ts)
 */
export class DsaCaptchaError extends Error {
    constructor() {
        super("dsa.discord.food requires a captcha for this session");
    }
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { result: DsaSearchResult; fetchedAt: number; }>();

/** Drops the cached result (e.g. after the user solved the captcha popup) */
export function clearUserCache(userId: string) {
    cache.delete(userId);
}

// Desktop: the request goes through the main process, which attaches the
// cookies of Discord's session (the captcha popup stores its session cookie
// there) and is not subject to the renderer's CSP or cookie SameSite rules.
// Web: plain credentialed fetch
const Native = VencordNative.pluginHelpers["DSA Lookup"] as PluginNative<typeof import("./native")> | undefined;

async function request(url: string): Promise<{ status: number; body: string; }> {
    if (Native) return Native.apiFetch(url);

    const response = await fetch(url, { credentials: "include" });
    return { status: response.status, body: await response.text() };
}

export async function fetchUserActions(userId: string): Promise<DsaSearchResult> {
    const cached = cache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result;

    const params = new URLSearchParams({
        parsedId: userId,
        includeTotalCount: "true",
        // the API caps at 100, which is plenty for a profile section; anything
        // beyond that is linked out to the site
        limit: "100",
        sort: "applicationDate",
        order: "desc",
    });

    const { status, body } = await request(`${API_BASE}/search?${params}`);
    if (status === 412) throw new DsaCaptchaError();
    if (status !== 200) throw new Error(`DSA API responded with ${status}: ${body.slice(0, 120)}`);

    let result: DsaSearchResult;
    try {
        result = JSON.parse(body) as DsaSearchResult;
    } catch {
        throw new Error(`DSA API returned invalid JSON: ${body.slice(0, 120)}`);
    }

    cache.set(userId, { result, fetchedAt: Date.now() });
    return result;
}

export function getTotal(result: DsaSearchResult): number {
    const { total } = result.pagination;
    if (total != null) {
        const parsed = typeof total === "number" ? total : parseInt(total, 10);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return result.actions.length;
}

// Sorted longest-first so e.g. DECISION_VISIBILITY_ is stripped before DECISION_
const ENUM_PREFIXES = [
    "STATEMENT_CATEGORY_",
    "DECISION_VISIBILITY_",
    "DECISION_GROUND_",
    "AUTOMATED_DECISION_",
    "CONTENT_TYPE_",
    "CATEGORY_",
    "KEYWORD_",
    "SOURCE_",
    "DECISION_",
].sort((a, b) => b.length - a.length);

/** STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH -> "Illegal or Harmful Speech" */
export function humanizeEnum(value: string): string {
    const prefix = ENUM_PREFIXES.find(p => value.startsWith(p));
    const stripped = prefix ? value.slice(prefix.length) : value;

    return stripped
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map(word => ["and", "or", "of"].includes(word) ? word : word[0].toUpperCase() + word.slice(1))
        .join(" ");
}

export function formatDate(iso: string): string {
    const date = new Date(iso);
    return isNaN(date.getTime())
        ? iso
        : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The most human-readable explanation the record carries */
export function getActionReason(action: DsaAction): string {
    return action.incompatibleContentGround
        ?? action.illegalContentExplanation
        ?? action.incompatibleContentExplanation
        ?? action.decisionFacts;
}

export interface DsaRestriction {
    label: string;
    endDate: string | null;
    active: boolean;
}

export function getRestrictions(action: DsaAction): DsaRestriction[] {
    const now = Date.now();
    const entries: [string | null, string | null][] = [
        ...(action.decisionVisibility?.map(decision => [decision, action.endDateVisibilityRestriction] as [string, string | null]) ?? []),
        [action.decisionAccount, action.endDateAccountRestriction],
        [action.decisionProvision, action.endDateServiceRestriction],
        [action.decisionMonetary, action.endDateMonetaryRestriction],
    ];

    return entries
        .filter(([decision]) => decision != null)
        .map(([decision, endDate]) => ({
            label: humanizeEnum(decision!),
            endDate,
            active: endDate != null && Date.parse(endDate) > now,
        }));
}
