/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, session } from "electron";

const SITE = "https://dsa.discord.food";
// the Turnstile widget is only mounted by the /download page — /home looks
// identical but never issues the session cookie
const CAPTCHA_URL = `${SITE}/download`;
// any /api/search request answers 412 until the session cookie exists (the
// gate runs before param validation), so this doubles as a cheap,
// cookie-name-agnostic "is verification done yet" probe
const PROBE_URL = `${SITE}/api/search?limit=1`;
const PROBE_INTERVAL_MS = 2500;
// stop probing after this many attempts (~5 minutes) — the window then just
// stays open until the user closes it
const PROBE_MAX_ATTEMPTS = 120;
// the window starts hidden: if the captcha auto-completes in the background,
// the user never sees it. If it hasn't by this deadline, show the window so
// the user can click the captcha manually. backgroundThrottling keeps the
// page's timers unthrottled while it is not rendered.
const SHOW_GRACE_MS = 8000;

/**
 * dsa.discord.food gates /api/search behind a Cloudflare Turnstile per fresh
 * session, and the widget's siteKey is domain-locked, so it cannot be solved
 * inside Discord's renderer. Instead, the site is opened in a real window on
 * Discord's default session — the same cookie jar the API requests read from —
 * so completing the captcha once in the popup unblocks every future lookup.
 *
 * The returned promise resolves when verification completes (the popup then
 * closes itself) or when the user closes the popup manually, so the renderer
 * can drop its cached captcha error and refetch.
 */
let popup: BrowserWindow | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;
const closeListeners: Array<() => void> = [];

function finish() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    closeListeners.splice(0).forEach(cb => cb());
}

export function openCaptchaPopup() {
    if (popup && !popup.isDestroyed()) {
        popup.focus();
    } else {
        popup = new BrowserWindow({
            title: "DSA Lookup — dsa.discord.food",
            width: 480,
            height: 640,
            autoHideMenuBar: true,
            show: false,
            webPreferences: { backgroundThrottling: false }
        });
        popup.on("closed", () => {
            popup = null;
            finish();
        });
        void popup.loadURL(CAPTCHA_URL);
        pollForVerification();
    }

    return new Promise<void>(resolve => closeListeners.push(resolve));
}

/**
 * Polls the API gate until the session cookie exists, then closes the popup.
 * If verification hasn't happened by SHOW_GRACE_MS the window is shown so the
 * user can complete the captcha manually — the probe keeps watching either way.
 */
function pollForVerification() {
    let attempts = 0;
    const startedAt = Date.now();
    let shown = false;
    pollTimer = setInterval(() => {
        if (++attempts > PROBE_MAX_ATTEMPTS) {
            finish();
            return;
        }
        if (probing || !popup || popup.isDestroyed()) return;

        // the captcha didn't auto-complete in the background — hand it over
        if (!shown && Date.now() - startedAt > SHOW_GRACE_MS) {
            shown = true;
            popup.show();
            popup.focus();
        }

        probing = true;
        void probeGate().then(verified => {
            probing = false;
            if (verified) {
                finish();
                popup?.close();
            }
        });
    }, PROBE_INTERVAL_MS);
}

async function probeGate(): Promise<boolean> {
    try {
        const response = await dsaFetch(PROBE_URL);
        return response.status !== 412;
    } catch {
        return false;
    }
}

function parseSetCookie(raw: string): Electron.CookiesSetDetails | null {
    const [pair, ...attrs] = raw.split(";").map(a => a.trim());
    const eq = pair.indexOf("=");
    if (eq <= 0) return null;

    const cookie: Electron.CookiesSetDetails = {
        url: SITE,
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
    };

    for (const attr of attrs) {
        const eqIdx = attr.indexOf("=");
        const key = (eqIdx === -1 ? attr : attr.slice(0, eqIdx)).toLowerCase();
        const value = eqIdx === -1 ? "" : attr.slice(eqIdx + 1);

        switch (key) {
            case "expires": {
                const date = new Date(value);
                if (!Number.isNaN(date.getTime())) cookie.expirationDate = date.getTime() / 1000;
                break;
            }
            case "max-age":
                cookie.expirationDate = Math.floor(Date.now() / 1000) + Number(value);
                break;
            case "domain":
                cookie.domain = value;
                break;
            case "path":
                cookie.path = value;
                break;
            case "secure":
                cookie.secure = true;
                break;
            case "httponly":
                cookie.httpOnly = true;
                break;
            case "samesite":
                if (value === "lax") cookie.sameSite = "lax";
                else if (value === "strict") cookie.sameSite = "strict";
                else if (value === "none") cookie.sameSite = "no_restriction";
                break;
        }
    }

    // Electron rejects SameSite=None without Secure
    if (cookie.sameSite === "no_restriction") cookie.secure = true;

    return cookie;
}

/** Fetches a dsa.discord.food URL with Discord's session cookies attached */
async function dsaFetch(url: string): Promise<Response> {
    const ses = session.defaultSession;
    // NOTE: query with the request url, not SITE — cookies.get({ url }) does
    // path matching, and a cookie scoped to Path=/api must not be missed
    const jar = await ses.cookies.get({ url });

    const headers: Record<string, string> = {
        "Accept": "application/json",
        "User-Agent": ses.getUserAgent(),
    };
    if (jar.length) headers.Cookie = jar.map(c => `${c.name}=${c.value}`).join("; ");

    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(15_000) });

    for (const raw of response.headers.getSetCookie()) {
        const cookie = parseSetCookie(raw);
        if (cookie) await ses.cookies.set(cookie).catch(() => { });
    }

    return response;
}

/**
 * Fetches a dsa.discord.food URL from the main process with the cookies of
 * Discord's default session attached. This sidesteps both the renderer's CSP
 * and cookie SameSite rules (the session cookie is set by the site itself, so
 * a cross-site renderer fetch may not be allowed to send it).
 */
export async function apiFetch(_: unknown, url: string): Promise<{ status: number; body: string; }> {
    if (!url.startsWith(`${SITE}/`)) throw new Error(`Refusing to fetch non-DSA url ${url}`);

    const response = await dsaFetch(url);
    return { status: response.status, body: await response.text() };
}

/** Debug helper: what DSA cookies does Discord's session currently hold */
export async function listCookies(_: unknown) {
    const jar = await session.defaultSession.cookies.get({ url: `${SITE}/` });
    return jar.map(c => ({ name: c.name, domain: c.domain, path: c.path, expires: c.expirationDate, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite }));
}
