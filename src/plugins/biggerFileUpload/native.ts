/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { request as httpsRequest } from "node:https";

import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";

// Fastest GoFile server from the last probe, with when it was measured —
// avoids re-pinging every server on every upload
let gofileFastestServer: { name: string; measuredAt: number; } | null = null;
const GOFILE_SERVER_CACHE_MS = 10 * 60 * 1000;

// Progress of the upload currently in flight. Uploads run in the main process
// where invoke-based IPC can't push events, so the renderer polls
// getUploadProgressNative() while an upload card is visible. Only one upload
// can run at a time (the renderer's upload flow is sequential), which this
// single slot relies on
let uploadProgress: { uploader: string; fileName: string; loaded: number; total: number; } | null = null;

export function getUploadProgressNative() {
    return uploadProgress;
}

// The request currently in flight, so cancelUploadNative can destroy it.
// Same single-slot assumption as uploadProgress: the renderer's upload flow
// is sequential. ClientRequest is typed from node:http — node:https
// re-exports the request function but not this type
let activeUploadRequest: import("node:http").ClientRequest | null = null;

export function cancelUploadNative() {
    if (activeUploadRequest) {
        activeUploadRequest.destroy(new Error("upload cancelled"));
        return { cancelled: true };
    }
    return { cancelled: false };
}

// 1MB slices keep write() calls small enough that backpressure (and thus the
// progress counter) reacts at a useful granularity
const PROGRESS_CHUNK_BYTES = 1024 * 1024;

interface StreamBody {
    bodyLength: number;
    // Generator factory: each call yields a fresh pass over the body, so a
    // 307/308 redirect can re-send it
    chunks: () => Iterable<Uint8Array>;
}

interface UploadResponse {
    status: number;
    statusText: string;
    text: string;
    retryAfter: string | undefined;
}

// POST/PUTs a body built by one of the builders below using node:https with
// drain-based backpressure: write() returns false once the socket buffer is
// full, and we only count bytes and continue on 'drain' — so onProgress
// tracks actual transmission, unlike fetch (which buffers the whole body
// eagerly and reports no progress at all)
function streamUpload(method: string, url: string, headers: Record<string, string>, body: StreamBody, onProgress?: (loaded: number) => void): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
        const send = (currentUrl: string, remainingRedirects: number, sendBody: boolean) => {
            // fetch redirect semantics: 301/302/303 become a bodyless GET,
            // only 307/308 re-send the method and body
            const req = httpsRequest(currentUrl, {
                method: sendBody ? method : "GET",
                headers: sendBody
                    ? { "User-Agent": VENCORD_USER_AGENT, ...headers, "Content-Length": String(body.bodyLength) }
                    : { "User-Agent": VENCORD_USER_AGENT }
            }, res => {
                if (res.statusCode! >= 300 && res.statusCode! < 400 && res.headers.location && remainingRedirects > 0) {
                    res.resume();
                    const next = new URL(res.headers.location, currentUrl).toString();
                    return send(next, remainingRedirects - 1, sendBody && (res.statusCode === 307 || res.statusCode === 308));
                }

                const parts: Buffer[] = [];
                res.on("data", c => parts.push(c));
                res.on("end", () => resolve({
                    status: res.statusCode!,
                    statusText: res.statusMessage ?? "",
                    text: Buffer.concat(parts).toString("utf-8"),
                    retryAfter: res.headers["retry-after"]
                }));
                res.on("error", reject);
            });
            req.on("error", reject);
            // Idle timeout — fires only when nothing at all has flowed over
            // the socket for 60s, not on total upload duration
            req.setTimeout(60000, () => req.destroy(new Error("upload stalled (no data flowed for 60s)")));

            // Track for cancelUploadNative; cleared on close so a finished
            // upload can't be "cancelled" by a stray button press
            activeUploadRequest = req;
            req.on("close", () => {
                if (activeUploadRequest === req) activeUploadRequest = null;
            });

            if (!sendBody) {
                req.end();
                return;
            }

            let loaded = 0;
            let ended = false;
            const it = body.chunks()[Symbol.iterator]();
            const writeNext = () => {
                if (ended) return;
                for (; ;) {
                    const { done, value } = it.next();
                    if (done) {
                        ended = true;
                        req.end();
                        return;
                    }
                    loaded += value.byteLength;
                    onProgress?.(loaded);
                    if (!req.write(value)) {
                        req.once("drain", writeNext);
                        return;
                    }
                }
            };
            writeNext();
        };
        send(url, 5, true);
    });
}

// Quotes inside a multipart filename would terminate the header early —
// anything header-hostile becomes an underscore
function sanitizePartName(name: string) {
    return name.replace(/["\r\n]/g, "_");
}

// Most uploaders answer errors with useful text (JSON messages, plain-text
// ban notices) — but 5xx responses are often entire HTML error pages, and
// dumping 500 chars of markup into the chat error message helps nobody
function describeErrorBody(body: string) {
    if (/^\s*(<!doctype\s+html|<html[\s>])/i.test(body)) {
        const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
        return title ? `service error page ("${title}")` : "service error page";
    }
    return body.trim().slice(0, 500);
}

// Manual multipart construction: FormData can't wrap a progress-reporting
// stream, so the body is assembled from encoded field parts + 1MB views of
// the file + a closing boundary
function buildMultipartBody(fields: Record<string, string | undefined>, fileFormName: string, fileName: string, fileType: string, fileBuffer: ArrayBuffer): StreamBody & { contentType: string; } {
    const enc = new TextEncoder();
    const boundary = `----VencordFormBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const safeName = sanitizePartName(fileName);

    const parts: Uint8Array[] = [];
    for (const [name, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${sanitizePartName(name)}"\r\n\r\n${value}\r\n`));
    }
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${sanitizePartName(fileFormName)}"; filename="${safeName}"\r\nContent-Type: ${fileType}\r\n\r\n`));
    const footer = enc.encode(`\r\n--${boundary}--\r\n`);

    const fileBytes = new Uint8Array(fileBuffer);
    const bodyLength = parts.reduce((n, p) => n + p.byteLength, 0) + fileBytes.byteLength + footer.byteLength;

    function* chunks(): Generator<Uint8Array> {
        for (const part of parts) yield part;
        for (let o = 0; o < fileBytes.byteLength; o += PROGRESS_CHUNK_BYTES)
            yield fileBytes.subarray(o, o + Math.min(PROGRESS_CHUNK_BYTES, fileBytes.byteLength - o));
        yield footer;
    }

    return {
        contentType: `multipart/form-data; boundary=${boundary}`,
        bodyLength,
        chunks
    };
}

// Raw octet-stream body (FileDitch's recommended shape for large files: a
// plain PUT with the filename in an X-Filename header, no multipart wrapper
// and no upload duration limit)
function buildRawBody(fileBuffer: ArrayBuffer): StreamBody {
    const fileBytes = new Uint8Array(fileBuffer);
    function* chunks(): Generator<Uint8Array> {
        for (let o = 0; o < fileBytes.byteLength; o += PROGRESS_CHUNK_BYTES)
            yield fileBytes.subarray(o, o + Math.min(PROGRESS_CHUNK_BYTES, fileBytes.byteLength - o));
    }
    return { bodyLength: fileBytes.byteLength, chunks };
}

// Wraps streamUpload with the shared progress bookkeeping: register the
// upload in the module slot the renderer polls, feed it byte counts, and
// always clear it when the upload settles
async function uploadWithProgress(uploader: string, fileName: string, total: number, run: (onProgress: (loaded: number) => void) => Promise<UploadResponse>): Promise<UploadResponse> {
    const progress = { uploader, fileName, loaded: 0, total };
    uploadProgress = progress;
    try {
        return await run(loaded => progress.loaded = loaded);
    } finally {
        uploadProgress = null;
    }
}

// Probes every server in parallel with a HEAD request and picks the one that
// responds first. Any HTTP response counts (404s included) — only network
// failures reject — since we are measuring round-trip time, not availability
// of a specific route
async function findFastestGofileServer(servers: { name: string; }[]): Promise<string> {
    if (gofileFastestServer && Date.now() - gofileFastestServer.measuredAt < GOFILE_SERVER_CACHE_MS) {
        return gofileFastestServer.name;
    }

    const probe = async (name: string) => {
        const start = performance.now();
        try {
            await fetch(`https://${name}.gofile.io/`, {
                method: "HEAD",
                signal: AbortSignal.timeout(5000)
            });
        } catch {
            return { name, latency: Infinity };
        }
        return { name, latency: performance.now() - start };
    };

    const results = (await Promise.all(servers.map(s => probe(s.name))))
        .sort((a, b) => a.latency - b.latency);

    if (results[0].latency === Infinity) {
        throw new Error("No GoFile server responded to the latency probe");
    }

    console.log(`[BiggerFileUpload] GoFile server latencies: ${results
        .map(r => `${r.name}=${r.latency === Infinity ? "unreachable" : `${Math.round(r.latency)}ms`}`)
        .join(", ")}`);

    gofileFastestServer = { name: results[0].name, measuredAt: Date.now() };
    return results[0].name;
}

export async function uploadFileToGofileNative(_, fileBuffer: ArrayBuffer, fileName: string, fileType: string, token?: string): Promise<any> {
    const serverResponse = await fetch("https://api.gofile.io/servers");
    if (!serverResponse.ok) {
        throw new Error(`GoFile server list request failed (HTTP ${serverResponse.status} ${serverResponse.statusText})`);
    }

    const serverData = await serverResponse.json();
    if (serverData?.status !== "ok" || !Array.isArray(serverData.data?.servers)) {
        const message = serverData?.data?.message ?? serverData?.data?.error ?? "no servers returned";
        throw new Error(`GoFile server list error (${serverData?.status ?? "unknown"}): ${message}`);
    }

    const server = await findFastestGofileServer(serverData.data.servers);

    const body = buildMultipartBody({ token }, "file", fileName, fileType, fileBuffer);
    const uploadUrl = `https://${server}.gofile.io/uploadFile`;

    const uploadResponse = await uploadWithProgress("GoFile", fileName, body.bodyLength, onProgress =>
        streamUpload("POST", uploadUrl, { "Content-Type": body.contentType }, body, onProgress)
    );

    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        throw new Error(`GoFile upload failed (HTTP ${uploadResponse.status} ${uploadResponse.statusText}): ${describeErrorBody(uploadResponse.text)}`);
    }

    try {
        return JSON.parse(uploadResponse.text);
    } catch {
        throw new Error(`GoFile returned a non-JSON response (HTTP ${uploadResponse.status}): ${describeErrorBody(uploadResponse.text)}`);
    }
}


export async function uploadFileToCatboxNative(_, url: string, fileBuffer: ArrayBuffer, fileName: string, fileType: string, extraField: { userhash?: string; time?: string; }): Promise<string> {
    const body = buildMultipartBody({
        reqtype: "fileupload",
        userhash: extraField.userhash,
        time: extraField.time
    }, "fileToUpload", fileName, fileType, fileBuffer);

    const response = await uploadWithProgress("Catbox", fileName, body.bodyLength, onProgress =>
        streamUpload("POST", url, { "Content-Type": body.contentType }, body, onProgress)
    );

    // Catbox reports failures as plain text with a 200 half the time and an
    // error status the other half — the caller treats any non-URL text as a
    // failure and shows it, so both cases just need the body preserved
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${describeErrorBody(response.text)}`);
    }

    return response.text;
}


// FileDitch needs no auth or config: a raw octet-stream PUT with the filename
// in X-Filename, answered with {success, url, filename, size} or {error} +
// HTTP code. Note the new hostname — the old one in the docs no longer serves
// the API
export async function uploadFileToFileDitchNative(_, fileBuffer: ArrayBuffer, fileName: string, fileType: string): Promise<any> {
    const body = buildRawBody(fileBuffer);

    const response = await uploadWithProgress("FileDitch", fileName, body.bodyLength, onProgress =>
        streamUpload("PUT", "https://new.fileditch.com/upload.php", {
            "Content-Type": fileType || "application/octet-stream",
            "X-Filename": sanitizePartName(fileName)
        }, body, onProgress)
    );

    if (response.status < 200 || response.status >= 300) {
        // Error bodies are {"error": "..."}; surface the message and the
        // Retry-After window when rate limited (HTTP 429)
        let message = describeErrorBody(response.text);
        try {
            message = JSON.parse(response.text).error ?? message;
        } catch { }
        if (response.status === 429 && response.retryAfter) {
            message = `rate limited — retry after ${response.retryAfter}s (${message})`;
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${message}`);
    }

    try {
        return JSON.parse(response.text);
    } catch {
        throw new Error(`FileDitch returned a non-JSON response (HTTP ${response.status}): ${describeErrorBody(response.text)}`);
    }
}


export async function uploadFileCustomNative(_, url: string, fileBuffer: ArrayBuffer, fileName: string, fileType: string, fileFormName: string, customArgs: Record<string, string>, customHeaders: Record<string, string>, responseType: string, urlPath: string[]): Promise<string> {
    const body = buildMultipartBody(customArgs, fileFormName, fileName, fileType, fileBuffer);

    // The boundary is part of our Content-Type; any caller-supplied one
    // would break the multipart framing
    delete customHeaders["Content-Type"];
    const headers = { ...customHeaders, "Content-Type": body.contentType };

    const uploadResponse = await uploadWithProgress("Custom", fileName, body.bodyLength, onProgress =>
        streamUpload("POST", url, headers, body, onProgress)
    );

    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        throw new Error(`HTTP ${uploadResponse.status} ${uploadResponse.statusText}${uploadResponse.text ? `: ${describeErrorBody(uploadResponse.text)}` : ""}`);
    }

    let uploadResult;
    if (responseType === "JSON") {
        try {
            uploadResult = JSON.parse(uploadResponse.text);
        } catch {
            throw new Error(`Server returned a non-JSON response (HTTP ${uploadResponse.status}): ${describeErrorBody(uploadResponse.text)}`);
        }
    } else {
        uploadResult = uploadResponse.text;
    }

    let finalUrl = "";
    if (responseType === "JSON") {
        let current = uploadResult;
        for (const key of urlPath) {
            if (current[key] === undefined) {
                throw new Error(`Invalid URL path: ${urlPath.join(".")}`);
            }
            current = current[key];
        }
        finalUrl = current;
    } else {
        finalUrl = uploadResult.trim();
    }

    return finalUrl;
}

export async function getEmbeddrLinkNative(_, link: string): Promise<string> {
    try {
        const response = await fetch("https://embeddr.top/link", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ url: link }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result.url;
    } catch (error) {
        console.error("Error getting embeddr.top link:", error);
        throw error;
    }
}
