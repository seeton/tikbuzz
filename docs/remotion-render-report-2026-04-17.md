# Remotion Render Failure Report

Date: 2026-04-17
Workspace: `/Users/seeton/tikbuzz`
Target run: `/Users/seeton/tikbuzz/runs/2026-04-15T06-40-18`

## Summary

`discover -> rank -> brief -> assets -> voice` までは完了した。
最終 `render` だけが失敗し、原因は `Remotion` 自体の構成不備ではなく、`Codex desktop 内の sandbox から Chromium を remote debugging 付きで起動できない` ことにある可能性が高い。

Remotion の Node renderer は Chromium 系ブラウザを `remote-debugging` 経由で制御する。
この環境では、そこに入った時点で `SIGABRT` または `SIGTRAP` が発生した。

## Five Retries

### Retry 1

Command shape:

- `remotion render`
- `--browser-executable /Applications/Google Chrome.app/.../Google Chrome`
- `--chrome-mode chrome-for-testing`

Result:

- Failed
- Browser exited with `SIGABRT`

Observed error:

- `Failed to launch the browser process!`
- `Closed with null signal: SIGABRT`

### Retry 2

Command shape:

- `remotion render`
- `--chrome-mode chrome-for-testing`
- Remotion-managed downloaded browser

Result:

- Failed
- Chrome for Testing downloaded successfully
- Render failed during browser launch / composition acquisition

Observed error:

- `Failed to launch the browser process!`

### Retry 3

Command shape:

- `remotion render`
- `--chrome-mode headless-shell`

Result:

- Failed
- Browser exited with `SIGTRAP`

Observed error:

- `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.<pid>: Permission denied (1100)`
- `Failed to launch the browser process!`

### Retry 4

Command shape:

- Direct Chrome launch, not through Remotion
- `--headless=new`
- `--remote-debugging-port=9230`
- `--user-data-dir=<temp>`
- `--disable-breakpad`
- `--disable-crash-reporter`
- `--disable-features=MachPortRendezvousValidatePeerRequirements,MachPortRendezvousEnforcePeerRequirements`

Result:

- Failed
- Immediate `Abort trap: 6`

Meaning:

- Even outside Remotion, `remote-debugging` path itself is not surviving in this sandbox.

### Retry 5

Command shape:

- `remotion render`
- `--browser-executable /tmp/remotion-chrome-wrapper.sh`
- wrapper script does only `exec '/Applications/Google Chrome.app/.../Google Chrome' "$@"`

Result:

- Failed
- Browser exited with `SIGABRT`

Meaning:

- Launching through a shell wrapper does not change the outcome.

## Additional Findings

- Simple local TCP listen works from this environment.
  - Node and Python both bound localhost ports successfully.
  - Therefore this is not a generic `localhost` or `network server` failure.
- Chrome without remote debugging can run for simple cases such as `--dump-dom`.
- Chrome with `--remote-debugging-port` or `--remote-debugging-pipe` aborts in this environment.
- Remotion-specific GitHub issue matching this exact failure was not found in `remotion-dev/remotion`.

## Likely Root Cause

The strongest working hypothesis is:

1. This Codex desktop thread runs under a macOS sandboxed environment.
2. Chromium's multi-process / Mach port registration path is denied inside that sandbox.
3. Remotion's renderer depends on that Chromium control path, so final render cannot complete here.

This aligns with similar reports in the Chromium/Electron ecosystem:

- Electron MAS / sandbox launch failures with `Permission denied (1100)`:
  - <https://github.com/electron-userland/electron-builder/issues/5506>
- NW.js signed app failures with Chromium crashpad / mach permission errors:
  - <https://github.com/nwjs/nw.js/issues/5791>
- Apple Developer Forums thread on sandboxed Chromium-style apps failing on `mach-register` / `MachPortRendezvousServer` and needing app-group aligned entitlements:
  - <https://developer.apple.com/forums/thread/808940>
- Another Chromium-app example showing `MachPortRendezvousServer` lookup failures:
  - <https://github.com/beekeeper-studio/beekeeper-studio/issues/2442>

## What Is Actually Complete

The following pipeline stages are working for the target run:

- `discover`
- `rank`
- `brief`
- `assets`
- `voice`

Artifacts already present for the run include:

- `brief.json`
- `source-log.json`
- `asset-log.json`
- `voice-log.json`
- generated WAV files
- `timeline.json`
- `render-props.json`

## Blocking Condition

The blocking condition is specific and narrow:

- `Remotion render` cannot launch a controllable Chromium instance from this sandboxed execution environment.

## Recommended Next Step

If rendering must stay on Remotion, the next move is not another code change inside this sandbox.
The next move is to run the same project from an unsandboxed macOS Terminal / normal shell session and verify whether the exact same `remotion render` command succeeds there.

If it succeeds outside the sandbox, the project is functionally correct and the blocker is execution environment, not the pipeline code.
