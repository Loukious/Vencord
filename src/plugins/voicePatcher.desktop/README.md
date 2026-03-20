# VoicePatcher

`VoicePatcher` is a desktop-only Vencord plugin that patches Discord's
`discord_voice.node` module in memory to enable stereo and related voice
behavior changes.

## How it works

1. `index.ts` starts the plugin from the renderer side.
2. The plugin first calls `DiscordNative.nativeModules.requireModule("discord_voice")`
   to make sure Discord has loaded `discord_voice.node`.
3. `index.ts` then calls the plugin-native helper in `native.ts`.
4. `native.ts` resolves the plugin directory, finds `patcher.node` and
   `patcher.ini`, and executes the native patcher from Electron's isolated
   preload world.
5. `patcher.node` scans the already-loaded `discord_voice.node` module in memory,
   finds patch locations from the pattern definitions in `patcher.ini`, and
   writes the replacement bytes directly into RAM.
6. The result is sent back to `index.ts`, which logs the patched module base,
   accepted patch definitions, and per-patch status.

This means the patch is applied live to the currently loaded voice module. The
INI does not need hardcoded RVAs anymore as long as the byte patterns still
match the current Discord build.

## Files

- `index.ts`: renderer-side plugin entrypoint and logging.
- `native.ts`: plugin-native bridge that loads `patcher.node` from the isolated
  preload context.
- `patcher.ini`: patch definitions, patterns, offsets, expected bytes, and
  replacement bytes.
- `patcher.node`: native addon that finds and patches the target code in memory.

At runtime, `native.ts` tries to download `patcher.node` and `patcher.ini` from
the latest `DiscordVoicePatcher` GitHub release into the local Vencord data
directory. If that download path is unavailable, it falls back to the source
tree for local development.

## INI format

Each section in `patcher.ini` describes one patch definition. Common fields:

- `pattern`: byte signature to search for. `??` is a wildcard byte.
- `sig_offset`: byte offset from the pattern match to the final patch site.
- `derive_from`: reuse another section's resolved address as an anchor.
- `derive_offset`: signed byte offset from the derived anchor.
- `expected`: bytes that must already exist before patching.
- `patch`: bytes to write.

The plugin logs how many patch definitions were accepted from the INI and the
status for each one after `patcher.node` runs.

## Source code for `patcher.node`

The native addon's source code is maintained outside this repository:

<https://github.com/Loukious/DiscordVoicePatcher>

This repository integrates with the upstream source for `patcher.node`, and the
plugin can fetch release assets from that upstream repository when available.

## Notes

- Downloaded runtime assets are cached under the local Vencord data directory so
  the plugin can continue working offline after a successful fetch.
- If Discord updates and the byte patterns stop matching, we only need to update
  `patcher.ini`.
- Because the patch is applied in memory, changes take effect immediately once
  the target code is patched.
