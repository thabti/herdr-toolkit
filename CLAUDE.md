# herdr-toolkit

A layout plus six mods for the Herdr desktop app (plain ES modules, no build step).
Formerly herdr-sab. Internal ids keep the `sab` prefix (layout `sab`, mods `sab-*`, `sab.json`, `layout:sab` keys, the `.herdr-sab` install marker); don't rename them, it breaks existing installs. Only user-visible text says herdr-toolkit.
User docs live in `docs/GUIDE.md`. Its §11 "How it is built" covers the file map and design notes.

## Workflow

- **Land on `main`.** Commit straight to `main` and push. Don't open feature branches or PRs unless asked.
- **Keep this file current.** Every change that adds a feature, setting, convention or gotcha updates this file in the same commit.
- **Docs move with code.** A user-visible change also updates `docs/GUIDE.md` (feature section plus the settings table) and the README's "What you get" list when it's a headline feature.
- **Screenshots** live in `docs/images/` (the README's tab bar shot is `tab-bar.png`). Retina captures are 2x, so set `width` to half the pixel width.
- After a change: run `scripts/install.sh`. It syncs shared files, copies the mods into `~/.config/herdr-app`, and runs `herdr-app check` on each one. Herdr hot-reloads the mods.
- To force a reload: `herdr-app do layout.switch --name sab`. Check the result with `herdr-app status` (`"errors": []`) and `herdr-app shot <png>`. Never restart the user's app or `hc`.

## Code rules

- **Shared code.** Herdr mods can't import each other. Edit `sab/shared/*.js` only, then run `scripts/sync-shared.sh`, which copies it into `sab-tabs`, `sab-panel`, `sab-settings`, `sab-spaces` and `sab-open-with`. Never edit the copies.
- **Settings.**
  - A new setting gets a default in `DEFAULTS` (`sab/shared/config.js`) with a comment.
  - Add a control in `sab/mods/sab-settings/main.js` (`toggle` / `stepper` / `choice` / `chips`) and a row in the GUIDE settings table.
  - Read settings through `cfg()`.
- **API reference.** `gpui-kit.d.ts` in each mod is the SDK reference (`herdr`, `gpui-kit`, `gpui-base`). It's gitignored, so grep it for an element method before using it.
- **Panels** (`sab/mods/sab-panel/*.js`) stay alive while hidden:
  - Gate reads on `isShown(this.id)`.
  - Capture `key()` before any await and drop the result when it changed (the user moved to another pane).
  - Pass `{ cwd, on }` to every `exec`; `on` is a remote machine or null.
  - `watchFolder` is local-only.
- **Git safety.** Commit only the listed files (`--literal-pathspecs add -A -- <paths>`), never `git add -A` on the whole tree. Pushes go through `sh -c 'GIT_TERMINAL_PROMPT=0 exec git "$@"'` so they fail instead of waiting on a hidden prompt.
- **GitHub.** Run gh through `ghAs(account, …)` with the account from `ghAccount(root, on)`, which picks the logged-in account that can see the repo.
- **Derived files.** Each one keeps its "Derived from / Modified by" header. Add a `Modified for herdr-toolkit:` line when you change what it does.
- **Style.** No spinners: use slow `.loop("opacity")` dots, because `.spin()` redraws the whole window.

## Changes panel (`changes.js`)

- **Single repository:** the original Herdr/Kanso behaviour.
- **Branch as the title.** The panel header and the tab bar's Changes button show the branch (`paneFolder()` in `sab-tabs` returns the focused pane's `branch`), falling back to "Changes".
- **Worktrees** (`changes.worktrees`): a repository with linked worktrees becomes `kind: "worktrees"`, one section per `git worktree list` entry (bare and prunable skipped), using the same multi-section UI as a folder.
  - `this.kind` is `repo`, `worktrees` or `folder`; `this.multi` is true for the last two. `this.here` is the pane's own worktree: sorted first, always shown, and the default Commit target. With several sections, files that are another section's root (a nested `.claude/worktrees/x/`) are dropped from the outer one.
  - `worktreesOf` caches the list for 30 s. In folder mode, one `find ./<repo>/.git/worktrees -maxdepth 0` call says which found repos have any, so only those pay for `git worktree list`.
- **Folder that isn't a repository** (`changes.nested`):
  - `findRepos` runs `find` up to `changes.scanDepth` deep. It skips hidden folders and `node_modules`, `vendor`, `dist`, `build`, `target`, `Pods`, as well as repos nested in a found repo.
  - It rescans every 30 s and never scans `~` or `/`.
  - It caps at `changes.maxRepos` (default 100). `~/Documents/work/GitHub/mumzworld` holds 55 repos.
  - **Git calls are expensive.** Each one costs about 80 ms through macOS's `/usr/bin/git` (Xcode shim), so the number of calls matters more than what they do:
    - `readRepo` makes one `git status --porcelain=v2 --branch` call, which also gives the branch and HEAD. `diff --numstat` runs only for a dirty repo.
    - `baseOf` caches each repo's base for 5 min; `aheadOf` caches the ahead count per HEAD.
    - A watch event re-reads only its own repo. The 10 s timer does a full multi-repo read at most every 30 s.
    - On 54 repos that is 2.4 s per refresh, down from 9.4 s.
  - `readRepo` returns `{ root, name, files, branch, base, ahead }`. `target()` picks the repo for Commit and Create PR: the filter chip, else the repo of the open diff.
- **Create PR** (`createPr` in `lib.js`, also used by the PR panel):
  - Pushes the branch (`-u origin HEAD` on the first push), then runs `gh pr create --fill [--draft] --head <branch>`.
  - It returns `{ url, existed }`.
  - The button shows only when the branch isn't `defaultBranch()` and `ahead > 0`.

## Spaces sidebar (`sab-spaces`)

- `list.js` is Herdr's shipped `spaces` mod (0.1.13), cloned. The layout's `spaces` block points at `sab-spaces`. Keep the clone's changes marked `herdr-toolkit:` so a newer Herdr version can be merged in.
- `pinOf` and `withPin(cwd, space)` live in `shared/config.js`. `withPin` returns the pin when the pane's folder is empty, the pin itself or one of its parents (`~`), else the pane's folder. Every "where is the pane" resolver uses it: `location()` in `sab-panel/lib.js`, `paneFolder` in sab-tabs and `resolveTarget` in sab-open-with.
- A space's repository is `pinOf(s)` (`spaces.repos[space id]`, local spaces only), else its first terminal's folder. `where()` uses it, so pins drive the git look and the nesting.
- `check()` also runs `git worktree list --porcelain` per place and keeps it in `this.trees[repo]`. `ordered()` adds rows `{ free, on, main, parent }` for checkouts no space shows. These rows are never part of the `space.move` ordering.
- The same mod draws its popups through `props.view`: `menu`, `worktree-menu`, `repo` and `remove` (`menus.js`). New and Open worktree reuse Herdr's `worktree` dialog with `{ folder, machine, action }`. Remove is ours, because Herdr's needs a space to close.
- Opening a checkout goes through the `start` view (`startPicker`): Terminal or an installed agent (`knownAgents`, with Herdr new-menu's cached `new-menu.agents` shown first). It then runs `space.new { folder, machine, argv, tab }`, or passes `{ argv, tab }` to Herdr's New worktree dialog. The last choice is shared `sab.spaces.start`. Always pass `machine: ""` for this computer: a click with no machine means the focused space's machine.
- **Rename** opens Herdr's `prompt` mod itself (`renameDialog`) with `value: s.name`, because `space.rename` with no name leaves the field empty for an unnamed space. `Shift-F2` is still Herdr's own and stays empty.
- `mod.open` can't pass props, so the popups can't be opened from the CLI. Test them with the Node stubs below.

## Memory panel, sidebar context, Jira titles

- **Off by default.** `panels.memory`, `context.spaces`, `jira.titles` and `spaces.worktrees` default to false, so a fresh install behaves as before these features until they are turned on. With `spaces.worktrees` off, `sab-spaces` lists no free worktrees and its right-click opens Herdr's `menu` mod, not `menus.js`.

- **Memory** (`sab-panel/memory.js`): CLAUDE.md / CLAUDE.local.md / .claude/CLAUDE.md in the pane's folder and every parent, the repo's and `~/.claude` rules, and auto memory at `~/.claude/projects/<path with [^A-Za-z0-9] → ->/memory`. Worktrees have no memory folder of their own: it tries the main checkout (`--git-common-dir`), then the repo top, then the folder. Local only.
- **Sidebar context:** sab-tabs publishes each Claude pane's reading as shared `CONTEXT_KEY` (`sab.context.panes`, `{ pane: { pct, at, size, model } }`) every 3 s. `list.js` `contextChip` takes the max per space. Setting `context.spaces`.
- **Jira titles** (`shared/jira.js`): `jiraTitle(key)` is safe to call while drawing: it only reads shared `sab.jira.titles` and queues the key. `fetchJiraTitles()` runs from timers (sab-tabs every 3 s with `tell`/`persist`; sab-spaces every 3 s). curl reads the login from `jira.netrc` (`--netrc-file`), never argv. Settings `jira.titles`, `jira.netrc`, `jira.tabTitle`, `jira.refreshMinutes`.
- **Export settings…** (`exportSettings` in sab-settings): `pickFolder`, then `writeTextFile(…, null)` of `diff(DEFAULTS, cfg())` to `herdr-toolkit-settings.json`; when that exists, the name gets a timestamp. Then `open -R`.

## Testing without the app

There is no test suite. To exercise a panel's logic, run it in Node with stub modules:

1. Register a loader hook (`module.register`) that maps `herdr`, `gpui-kit` and `gpui-base` to stub files:
   - `exec` → `child_process.execFile` returning `{ code, stdout, stderr }`.
   - Elements → a Proxy that records `child`/`children`/`id`/`on_click`.
   - `watchFolder` → a promise that rejects.
2. Drive `init` / `refresh` / `render` against throwaway repos in the scratchpad.

Two tricks:
- **Fake GitHub:** a local bare repo plus `git config url.<bare>.pushInsteadOf https://github.com/…`, and a fake `gh` script first on `PATH`.
- **Throwaway repos under zsh:** set the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars rather than splitting `git -c …` from a variable.

Never point a test that commits or pushes at the user's real repos.
