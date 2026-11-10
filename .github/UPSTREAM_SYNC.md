# Syncing upstream

The daily `Upstream Sync` workflow merges `upstream/main`, lets the pinned pnpm
version resolve lockfile conflicts, and validates the result before committing
and pushing. Validation includes `pnpm audit` and dependency compatibility tests
to prevent known vulnerabilities from being synced back in. Source, manifest,
and workflow conflicts stop the sync for review.

For a local sync, start with a clean working tree:

```sh
git fetch upstream main
node scripts/mergeUpstream.mjs
```

The helper leaves the merge staged for review. It also enables Git rerere in this
checkout so Git can reuse previously recorded conflict resolutions. Run the same
validation commands as `.github/workflows/autoSync.yml`, then finish with
`git commit --no-edit`. The helper does not push.

If source conflicts stop the merge, resolve and stage those files first, then run:

```sh
pnpm install --lockfile-only --no-frozen-lockfile --ignore-scripts
git add pnpm-lock.yaml
pnpm install --frozen-lockfile
```

Review, validate, and commit as above, or use `git merge --abort` to cancel.

Keep `pnpm-lock.yaml` tracked and use the `packageManager` version in `package.json`.
Do not use an `ours`, `theirs`, or `union` merge driver for it: the merged dependency
manifests must agree with the generated lockfile. The helper also reconciles a
textually clean lockfile merge, since Git cannot check dependency consistency.
