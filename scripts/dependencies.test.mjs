/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";

import pathAlias from "eslint-plugin-path-alias";
import { unzipSync } from "fflate";
import ts from "typescript";
import transformPathsModule from "typescript-transform-paths";

test("path-alias linting preserves glob exceptions and the sibling-import patch", () => {
    function lintImport(value, exceptions, dynamic) {
        const reports = [];
        const visitors = pathAlias.rules["no-relative"].create({
            options: [{ paths: { "@fixture": resolve("src") }, exceptions }],
            getFilename: () => resolve("src/components/Fixture.tsx"),
            getCwd: () => process.cwd(),
            report: report => reports.push(report)
        });
        visitors[dynamic ? "ImportExpression" : "ImportDeclaration"]({
            source: { type: "Literal", value, raw: JSON.stringify(value) }
        });
        return reports;
    }

    for (const dynamic of [false, true]) {
        const [report] = lintImport("../utils/value", [], dynamic);
        assert.equal(report.messageId, "shouldUseAlias");
        assert.equal(report.fix({ replaceText: (_, text) => text }).replaceAll("\\", "/"), '"@fixture/utils/value"');
        assert.equal(lintImport("../utils/theme.module.css", ["*.module.css"], dynamic).length, 0);
        assert.equal(lintImport("../utils/value", ["*.module.css"], dynamic).length, 1);
        assert.equal(lintImport("../utils/theme.module.css", ["*.css", "!theme.module.css"], dynamic).length, 1);
        assert.equal(lintImport("./Sibling", [], dynamic).length, 0);
    }
});

test("declaration transforms rewrite aliases while honoring glob exclusions", t => {
    const root = mkdtempSync(join(tmpdir(), "vencord-dependencies-"));
    t.after(() => {
        assert.equal(realpathSync(dirname(root)), realpathSync(tmpdir()));
        assert.ok(basename(root).startsWith("vencord-dependencies-"));
        rmSync(root, { recursive: true, force: true });
    });
    mkdirSync(join(root, "shared/excluded"), { recursive: true });
    writeFileSync(join(root, "shared/allowed.ts"), "export const allowed = 1;\n");
    writeFileSync(join(root, "shared/excluded/value.ts"), "export const excluded = 2;\n");
    writeFileSync(join(root, "index.ts"), 'export { allowed } from "@shared/allowed";\nexport { excluded } from "@shared/excluded/value";\n');

    const program = ts.createProgram([join(root, "index.ts")], {
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: root,
        outDir: join(root, "dist"),
        paths: { "@shared/*": [join(root, "shared/*")] },
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        types: []
    });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
    const result = program.emit(undefined, undefined, undefined, true, {
        afterDeclarations: [transformPathsModule.default(program, { exclude: ["**/excluded/**"] }, { ts })]
    });
    assert.equal(result.emitSkipped, false);
    const output = readFileSync(join(root, "dist/index.d.ts"), "utf8");
    assert.match(output, /from "\.\/shared\/allowed"/);
    assert.match(output, /from "@shared\/excluded\/value"/);
});

for (const [archive, directory, manifestVersion] of [
    ["extension-chrome.zip", "chromium-unpacked", 3],
    ["extension-firefox.zip", "firefox-unpacked", 2]
]) {
    test(`${archive} contains exactly the unpacked extension files`, () => {
        const root = resolve("dist", directory);
        const entries = unzipSync(readFileSync(resolve("dist", archive)));
        const expected = readdirSync(root, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
        assert.deepEqual(Object.keys(entries).sort(), expected.sort());
        for (const [name, bytes] of Object.entries(entries))
            assert.deepEqual(Buffer.from(bytes), readFileSync(join(root, name)), name);
        const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString("utf8"));
        assert.equal(manifest.manifest_version, manifestVersion);
        assert.equal(manifest.version, JSON.parse(readFileSync("package.json", "utf8")).version);
        assert.ok(entries["vendor/monaco/index.html"]);
        assert.ok(entries["dist/Vencord.js"]);
        assert.ok(entries["dist/Vencord.css"]);
    });
}
