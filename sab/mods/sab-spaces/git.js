// Git and space helpers for sab-spaces: the pinned repository of a space, the
// checkouts of a repository, and which spaces show a checkout.
import { exec, panes, spaces } from "herdr";
import { pinOf } from "./config.js";

export { pinOf };

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(s, ps = panes()) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// The folder that stands for a space's repository: its pin, else where it is.
export const repoFolder = (s, ps) => pinOf(s) || place(s, ps);

export async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

// The repository a folder is in: { top, main, name, linked }, null outside git.
// `top`: this checkout; `main`: the repository's main checkout.
export async function repoOf(folder, on) {
  if (!folder) return null;
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

// `git worktree list --porcelain` as [{ path, branch, main, locked }], the main
// checkout first. Bare and prunable entries (their folder is gone) are left out.
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text ?? "").trim().split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    const first = out.length === 0 && !lines.includes("bare");
    if (lines.includes("bare") || lines.some((l) => l.startsWith("prunable"))) { out.push(null); continue; }
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: first, locked: lines.some((l) => l === "locked" || l.startsWith("locked ")) });
  }
  return out.filter(Boolean);
}

const inside = (p, dir) => p === dir || p.startsWith(dir + "/");

// The spaces showing a checkout (a pin to it, or their terminal is in it).
export function spacesOn(path, on, ps = panes()) {
  return spaces().filter((s) => (s.machine ?? null) === (on ?? null) && inside(repoFolder(s, ps) ?? "", path));
}

// ~ for the home folder.
export const tilde = (path, home) => (home && path?.startsWith(home) ? `~${path.slice(home.length)}` : path ?? "");
