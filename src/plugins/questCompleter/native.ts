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

/**
 * Posts JSON to the activity proxy ({appId}.discordsays.com) from the main
 * process, where fetch is not subject to CORS. The .proxy/acf backend only
 * ever sees requests from inside the activity's own iframe, so whether it
 * allows Discord's origin is unknown — in the renderer those calls can fail,
 * here they cannot.
 */
export async function activityProxyPostNative(
    _: Electron.IpcMainInvokeEvent,
    url: string,
    headers: Record<string, string>,
    body: unknown
): Promise<{ status: number; ok: boolean; body: any; }> {
    // This runs in the privileged main process with renderer-supplied values,
    // so validate the URL is https on an {appId}.discordsays.com host before
    // fetching it
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^\d+\.discordsays\.com$/.test(parsed.hostname)) {
        return { status: 0, ok: false, body: { error: "refused: not a discordsays activity host" } };
    }

    // redirect:"error" so a 3xx can't bounce the X-Auth-Token / proxy-ticket
    // Referer to another host from the CSP-free main process; the acf
    // endpoints answer 200/4xx directly
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error"
    });

    return {
        status: response.status,
        ok: response.ok,
        body: await response.json().catch(() => null)
    };
}
