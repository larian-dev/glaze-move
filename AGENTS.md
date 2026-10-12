# AGENTS.md

Working notes for agents (and humans) in this repo. Everything here was learned from a
mistake that actually happened; take it as binding.

## The shell

The Bash tool behaves like a POSIX shell on this machine, not cmd.exe — verified:
`rm -f` works, `%TEMP%` passes through unexpanded, and backslashes are stripped
(`node_modules\.bin\tsc` reaches the shell as `node_modules.bintsc`).

- Use forward slashes in every path: `node_modules/.bin/tsc --noEmit`.
- One command per tool call. Chain a genuine sequence with `&&`. Never use `;` as a
  separator — it hides failures and, in the old cmd-era harness, created stray `echo/`
  and `ok/` directories from a single `mkdir` line.
- For anything non-trivial in PowerShell, write a `.ps1` file with the Write tool and run
  `powershell -NoProfile -ExecutionPolicy Bypass -File <full path>`. Inline `-Command`
  quoting does not survive the trip through the tool.
- There is no `%VAR%` expansion — use absolute paths.

## Scratch files and temp files

- Throwaway probes, screenshots and scripts belong in the system temp directory
  (`C:/Users/<user>/AppData/Local/Temp`), never in the repo — a stray `pngcheck.ts` in
  the project root happened once.
- Create a scratch directory with a single `mkdir "<path>"` call; never
  `bun add --cwd <path>` (it silently installed into the home directory and left a stray
  `node_modules`, `bun.lock` and dependency line there).
- Delete every probe and screenshot before you finish.

## Kill the node/chrome processes your testing spawned

**Any chrome process you spawn for testing must be killed after you are done — no
exceptions.** If your run launched a dedicated Chromium (headed mode, `app.path`, or any
`--user-data-dir` of its own), close its tabs and then stop that process by PID
(`Stop-Process -Id <pid> -Force`). The harness's shared daemon under `.omp\puppeteer` is
the only chrome that may stay alive, and only when the audit below shows it is not yours.

Every verification round spawns processes: vitest workers (node), `vite preview`/`dev`
(node), and the managed Chromium for browser smokes. When you are done — before you
yield — clean them up:

1. Stop every server you started: `write proc://<id>/kill`.
2. Close browser tabs (`await tab.close()`); release browsers you launched with
   `await browser.close({ all: true })` (`kill: true` when this session spawned the
   browser itself).
3. Audit for leftovers: enumerate processes with a temp PowerShell script —
   `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','chrome.exe') } |
   ForEach-Object { $_.ProcessId, $_.CommandLine }` — and stop **only** the ones whose
   command line shows they came from your run, by PID: `Stop-Process -Id <pid> -Force`.
4. NEVER mass-kill node.exe or chrome.exe: that takes out the user's dev servers, editor
   and language servers. Kill only what you can positively identify as yours; leave the
   rest alone and say so. (A `typescript-language-server` genuinely holding one of your
   scratch files is safe to kill — identify the PID first, never guess — and the editor
   restarts it on the next file open.)

## Verifying work

All three must pass before a change is done:

```
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run
node_modules/.bin/vite build
```

If `bun run <script>` itself fails with an environmental error ("corrupted
node_modules", "could not create process"), invoke the binaries directly as above —
that failure is environmental, not a code error.

## Data files are the user's to change

`src/data/oxides.json` and `src/data/materials.json` are the source of truth
for classification and analyses. Do not "fix" values in them to make a test pass — if a
test depends on a specific oxide's class, build a local stub index in the test instead
(see `stubOxides` in `test/core.test.ts`).