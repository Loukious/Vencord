/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { escapeRegExp } from "@utils/text";

export interface ActivityProtocol {
    headers: Record<string, string>;
    authorizationHasActivityId: boolean;
    progressHasQuestId: boolean;
    questIdHeader: boolean;
}

const unsupportedProtocol = "This achievement activity uses an unsupported progress protocol";

function getExport(code: string, name: string) {
    return code.match(new RegExp(`[$\\w]+\\([$\\w]+\\.exports,"${escapeRegExp(name)}",function\\(\\)\\{return ([$\\w]+)\\}\\)`))?.[1];
}

function getImport(code: string, moduleId: string) {
    return code.match(new RegExp(`([$\\w]+)=[$\\w]+\\("${escapeRegExp(moduleId)}"\\)`))?.[1];
}

function getFunction(code: string, name: string) {
    const match = code.match(new RegExp(`function ${escapeRegExp(name)}\\(([^)]*)\\)\\{`));
    if (!match) return;

    let depth = 1;
    let quote = "";
    for (let i = match.index! + match[0].length; i < code.length; i++) {
        const char = code[i];
        if (quote) {
            if (char === "\\") i++;
            else if (char === quote) quote = "";
        } else if (char === '"' || char === "'" || char === "`") {
            quote = char;
        } else if (char === "{") {
            depth++;
        } else if (char === "}" && --depth === 0) {
            return { code: code.slice(match.index, i + 1), parameters: match[1].split(",") };
        }
    }
}

function hasIdentifyScope(code: string, requestImport: string, applicationId: string) {
    const functions = Array.from(code.matchAll(/async function ([$\w]+)\(\)/g))
        .map(match => getFunction(code, match[1]))
        .filter(fn => fn != null)
        .filter(fn => fn.code.includes(".commands.authorize({") && fn.code.includes(`${requestImport}.authorize(`));
    if (functions.length !== 1) return false;

    const authorize = functions[0].code.match(/\.commands\.authorize\(\{client_id:([$\w]+),response_type:"code",state:"",prompt:"none",scope:([$\w]+)\}\)/);
    if (!authorize || !new RegExp(`(?:let |,)${escapeRegExp(authorize[1])}="${applicationId}"(?:,|;)`).test(code)) return false;

    const scope = escapeRegExp(authorize[2]);
    let prefix = functions[0].code.slice(0, authorize.index);
    const initialization = prefix.match(new RegExp(`(?:let |,)${scope}=\\["identify"\\],([$\\w]+);`));
    if (!initialization) return false;

    const extra = escapeRegExp(initialization[1]);
    if (new RegExp(`(?<![$\\w])${extra}=(?!=)`).test(prefix)) return false;
    prefix = prefix.replace(initialization[0], "").replace(new RegExp(`${extra}&&\\(${extra}\\.split\\(","\\)\\.forEach\\(([$\\w]+)=>${scope}\\.push\\(\\1\\)\\),console\\.log\\("\\[Arise\\] added additional scopes\\. ",${scope}\\)\\)`), "");

    const guildScope = prefix.match(new RegExp(`([$\\w]+)&&!${scope}\\.includes\\("guilds\\.members\\.read"\\)&&${scope}\\.push\\("guilds\\.members\\.read"\\)`));
    if (guildScope) {
        const guild = escapeRegExp(guildScope[1]);
        if (!new RegExp(`(?:let |,)${guild}=null(?:,|;)`).test(code)
            || Array.from(code.matchAll(new RegExp(`(?<![$\\w])${guild}=(?!=)`, "g"))).length !== 1) return false;
        prefix = prefix.replace(guildScope[0], "");
    }

    return !new RegExp(`(?<![$\\w])${scope}(?![$\\w])`).test(prefix);
}

export function parseActivityProtocol(applicationId: string, source: string): ActivityProtocol {
    // Follow current Parcel module imports and exports instead of combining unrelated matches.
    const starts = Array.from(source.matchAll(/[$\w]+\("([^"\n]+)",function\([$\w]+,[$\w]+\)\{/g));
    const modules = starts.map((match, index) => ({ id: match[1], code: source.slice(match.index, starts[index + 1]?.index) }));
    const requests = modules.filter(module => ["setAuthToken", "authorize", "questProgress", "checkQuest"].every(name => getExport(module.code, name)));
    if (requests.length !== 1) throw new Error(unsupportedProtocol);
    const request = requests[0];
    const authorizeFn = getFunction(request.code, getExport(request.code, "authorize")!);
    const progressFn = getFunction(request.code, getExport(request.code, "questProgress")!);
    const authorization = authorizeFn?.code.match(/return await ([$\w]+)\("POST","\/authorize",\{code:([$\w]+)(?:,activityId:([$\w]+)\(\))?\}\)/);
    const progress = progressFn?.code.match(/await ([$\w]+)\("POST","\/quest\/progress",\{progress:([$\w]+)(?:,quest_id:([$\w]+))?\}\)/);
    if (!authorization || !progress || authorization[1] !== progress[1]
        || authorizeFn?.parameters.length !== 1 || authorization[2] !== authorizeFn.parameters[0]
        || progress[2] !== progressFn?.parameters[0] || progressFn.parameters.length !== (progress[3] == null ? 1 : 2)
        || progress[3] != null && progress[3] !== progressFn.parameters[1]
        || !progressFn.code.includes('.status==="ok"')) throw new Error(unsupportedProtocol);

    const transportFn = getFunction(request.code, authorization[1]);
    const transport = transportFn?.code ?? "";
    const requestHeaders = transport.match(/fetch\("\/\.proxy\/acf"\+([$\w]+),\{method:([$\w]+),headers:\{([^{}]+)\}/);
    if (!requestHeaders || requestHeaders[1] !== transportFn?.parameters[1] || requestHeaders[2] !== transportFn?.parameters[0]) throw new Error(unsupportedProtocol);
    const headers = requestHeaders[3];
    const universeId = headers?.match(/"X-Universe-ID":"([\da-f-]{36})"/i)?.[1];
    const activityId = headers?.match(/"X-Discord-Activity-Id":([$\w]+)(?:,|$)/)?.[1];
    const hostAssignment = activityId && transport.match(new RegExp(`(?:let |,)${escapeRegExp(activityId)}=(?:window\\.location\\.hostname\\.split\\("\\."\\)\\[0\\]|([$\\w]+)\\(\\))(?:,|;)`));
    const isHostFunction = (name: string) => getFunction(request.code, name)?.code === `function ${name}(){return window.location.hostname.split(".")[0]}`;
    const versionImport = headers?.match(/"X-Arise-Client":([$\w]+)\.appVersion(?:,|$)/)?.[1];
    const version = modules.find(module => getImport(request.code, module.id) === versionImport && getExport(module.code, "appVersion"))?.code ?? "";
    const oauth = modules.filter(module => getExport(module.code, "default") && getImport(module.code, request.id)
        && module.code.includes(".commands.authorize({"));

    // Read the two observed version expressions without executing downloaded JavaScript.
    const hashedVersion = version.match(/"appVersion",function\(\)\{return ([$\w]+)\}\);let ([$\w]+)="([^"]*)",([$\w]+)="([^"]*)",\1=\2\?`\$\{\4\}-\$\{\2\}`:\4/);
    const taggedVersion = version.match(/"appVersion",function\(\)\{return ([$\w]+)\}\);let ([$\w]+)="([^"]*)",\1=\2&&1\?\2:"([^"]*)"/);
    const clientVersion = hashedVersion
        ? hashedVersion[3] ? `${hashedVersion[5]}-${hashedVersion[3]}` : hashedVersion[5]
        : taggedVersion?.[3] || taggedVersion?.[4];

    if (!headers || !universeId || !clientVersion || !hostAssignment
        || hostAssignment[1] != null && !isHostFunction(hostAssignment[1])
        || authorization[3] != null && !isHostFunction(authorization[3])
        || oauth.length !== 1 || !hasIdentifyScope(oauth[0].code, getImport(oauth[0].code, request.id)!, applicationId)
        || !headers.includes('"X-Discord-Hostname":window.location.hostname')
        || !versionImport) {
        throw new Error(unsupportedProtocol);
    }

    return {
        headers: {
            "X-Universe-ID": universeId,
            "X-Discord-Activity-Id": applicationId,
            "X-Discord-Hostname": `${applicationId}.discordsays.com`,
            "X-Arise-Client": clientVersion
        },
        authorizationHasActivityId: authorization[3] != null,
        progressHasQuestId: progress[3] != null,
        questIdHeader: headers.includes('"X-Discord-Quest-ID":')
    };
}

export async function fetchActivityProtocol(applicationId: string, fetchText: (url: string) => Promise<string>) {
    if (!/^\d+$/.test(applicationId)) throw new Error("Invalid activity application ID");

    const origin = `https://${applicationId}.discordsays.com`;
    const html = await fetchText(`${origin}/`);
    const scripts = Array.from(html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi));
    const script = scripts.map(match => new URL(match[1] ?? match[2] ?? match[3], origin))
        .find(url => url.origin === origin && !url.username && !url.password
            && /^\/arise-frontend\.[\da-f]+\.js$/i.test(url.pathname)
            && !url.search && !url.hash);

    if (!script) throw new Error(unsupportedProtocol);

    return parseActivityProtocol(applicationId, await fetchText(script.href));
}
