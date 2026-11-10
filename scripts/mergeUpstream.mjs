/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";

function run(command, args, { capture = false, allowFailure = false } = {}) {
    const windowsPnpm = process.platform === "win32" && command === "pnpm";
    const result = spawnSync(windowsPnpm ? "cmd.exe" : command, windowsPnpm ? ["/d", "/s", "/c", "pnpm", ...args] : args, {
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit"
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && !allowFailure)
        throw new Error(`${command} ${args.join(" ")} failed (${result.status}).`);
    return result;
}

function mergeUpstream() {
    process.chdir(run("git", ["rev-parse", "--show-toplevel"], { capture: true }).stdout.trim());

    if (run("git", ["rev-parse", "--verify", "-q", "MERGE_HEAD"], { capture: true, allowFailure: true }).status === 0)
        throw new Error("A merge is already in progress. Finish or abort it before syncing again.");
    if (run("git", ["status", "--porcelain"], { capture: true }).stdout.trim())
        throw new Error("Commit or stash your changes before syncing upstream.");

    run("git", ["config", "--local", "rerere.enabled", "true"]);
    run("git", ["config", "--local", "rerere.autoupdate", "false"]);

    const merge = run("git", ["merge", "--no-commit", "--no-ff", "upstream/main"], { allowFailure: true });
    const conflicts = run("git", ["diff", "--name-only", "--diff-filter=U", "-z"], { capture: true })
        .stdout.split("\0").filter(Boolean);
    if (conflicts.some(file => file !== "pnpm-lock.yaml"))
        throw new Error(`Resolve and stage these conflicts manually before regenerating the lockfile: ${conflicts.join(", ")}`);
    if (merge.status !== 0 && conflicts.length === 0)
        throw new Error("Git could not merge upstream. See its output above.");
    if (run("git", ["rev-parse", "--verify", "-q", "MERGE_HEAD"], { capture: true, allowFailure: true }).status !== 0)
        return;

    // pnpm understands lockfile conflict markers and preserves compatible versions from both branches.
    run("pnpm", ["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"]);
    run("pnpm", ["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"]);
    run("git", ["add", "--", "pnpm-lock.yaml"]);
    run("git", ["diff", "--cached", "--check"]);
    console.log("Upstream merged. Review and validate the staged changes, then run git commit --no-edit.");
}

try {
    mergeUpstream();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
