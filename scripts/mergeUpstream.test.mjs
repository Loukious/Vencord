/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./mergeUpstream.mjs", import.meta.url));
const { packageManager } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function fixture(t) {
    const cwd = mkdtempSync(join(tmpdir(), "vencord-merge-"));
    t.after(() => {
        assert.equal(realpathSync(dirname(cwd)), realpathSync(tmpdir()));
        assert.ok(basename(cwd).startsWith("vencord-merge-"));
        rmSync(cwd, { recursive: true, force: true });
    });

    function run(command, args, allowFailure = false) {
        const windowsPnpm = process.platform === "win32" && command === "pnpm";
        const result = spawnSync(windowsPnpm ? "cmd.exe" : command, windowsPnpm ? ["/d", "/s", "/c", "pnpm", ...args] : args, {
            cwd,
            encoding: "utf8"
        });
        assert.ifError(result.error);
        if (!allowFailure) assert.equal(result.status, 0, result.stdout + result.stderr);
        return result;
    }
    const git = (...args) => run("git", args).stdout.trim();
    const install = () => run("pnpm", ["install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"]);
    const sync = () => run(process.execPath, [script], true);
    const write = (file, content) => writeFileSync(join(cwd, file), content);
    const read = file => readFileSync(join(cwd, file), "utf8");
    const commit = () => {
        git("add", ".");
        git("commit", "-m", "Fixture changes");
    };
    const manifest = {
        name: "merge-fixture",
        private: true,
        packageManager,
        dependencies: {},
        scripts: {
            test: "node --version"
        },
        engines: {
            node: ">=22"
        },
        devDependencies: {}
    };
    const writeManifest = () => write("package.json", JSON.stringify(manifest, null, 4) + "\n");

    git("init", "--initial-branch=main");
    git("config", "user.name", "Merge Test");
    git("config", "user.email", "merge-test@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", join(cwd, "disabled-hooks"));
    git("config", "core.autocrlf", "false");
    writeManifest();
    write("source.txt", "base\n");
    write(".gitignore", "node_modules\n");
    for (const name of ["alpha", "beta"]) {
        mkdirSync(join(cwd, name));
        write(`${name}/package.json`, JSON.stringify({ name, version: "1.0.0" }) + "\n");
    }
    install();
    commit();
    git("branch", "upstream/main");
    return { git, run, install, sync, write, read, commit, manifest, writeManifest };
}

test("resolves a real lockfile conflict and preserves both branches' dependencies", t => {
    const repo = fixture(t);
    repo.git("checkout", "upstream/main");
    repo.manifest.dependencies.alpha = "link:./alpha";
    repo.writeManifest();
    repo.install();
    repo.commit();

    repo.git("checkout", "main");
    repo.manifest.dependencies = {};
    repo.manifest.devDependencies.beta = "link:./beta";
    repo.writeManifest();
    repo.install();
    repo.commit();
    const head = repo.git("rev-parse", "HEAD");

    const result = repo.sync();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Merge conflict detected in pnpm-lock.yaml and successfully merged/);
    assert.equal(repo.git("diff", "--name-only", "--diff-filter=U"), "");
    assert.equal(repo.git("rev-parse", "HEAD"), head);
    assert.equal(repo.git("rev-parse", "MERGE_HEAD"), repo.git("rev-parse", "upstream/main"));
    assert.match(repo.read("pnpm-lock.yaml"), /link:alpha/);
    assert.match(repo.read("pnpm-lock.yaml"), /link:beta/);
    repo.run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
});

test("reconciles a clean merge whose manifest needs a lockfile update", t => {
    const repo = fixture(t);
    repo.git("checkout", "upstream/main");
    repo.manifest.dependencies.alpha = "link:./alpha";
    repo.writeManifest();
    repo.commit();
    repo.git("checkout", "main");

    const result = repo.sync();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(repo.read("pnpm-lock.yaml"), /link:alpha/);
    assert.ok(repo.git("diff", "--cached", "--name-only").includes("pnpm-lock.yaml"));
    repo.run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
});

test("leaves source conflicts unresolved and does not touch the lockfile", t => {
    const repo = fixture(t);
    repo.git("checkout", "upstream/main");
    repo.write("source.txt", "upstream\n");
    repo.commit();
    repo.git("checkout", "main");
    repo.write("source.txt", "fork\n");
    repo.commit();
    const lockfile = repo.read("pnpm-lock.yaml");

    const result = repo.sync();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Resolve and stage these conflicts manually/);
    assert.equal(repo.git("diff", "--name-only", "--diff-filter=U"), "source.txt");
    assert.equal(repo.read("pnpm-lock.yaml"), lockfile);
    assert.match(repo.sync().stderr, /A merge is already in progress/);
});

test("an up-to-date sync is a no-op and a dirty checkout is refused", t => {
    const repo = fixture(t);
    const head = repo.git("rev-parse", "HEAD");
    const result = repo.sync();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(repo.git("status", "--porcelain"), "");
    assert.equal(repo.git("rev-parse", "HEAD"), head);
    repo.write("source.txt", "local edits\n");
    assert.match(repo.sync().stderr, /Commit or stash your changes/);
    assert.equal(repo.read("source.txt"), "local edits\n");
    assert.equal(repo.git("rev-parse", "HEAD"), head);
});
