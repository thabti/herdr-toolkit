// sab-spaces' popups and dialogs, opened as overlays of this mod with props.view:
//   "menu"           a space's right-click menu: Rename, New / Open / Remove worktree,
//                    Set repository, Close
//   "worktree-menu"  a checkout no space is open on: Open in a new space, Remove
//   "repo"           pick the repository a space stands for (spaces.repos)
//   "remove"         remove a worktree: closes the spaces on it, then git worktree remove
//   "start"          what a new space on a worktree starts with: a terminal or an agent
// New and Open worktree go to Herdr's own worktree dialog, given the repository's folder.
// Rename opens Herdr's prompt dialog itself, so the field starts with the current name.
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, spaces, panes, home, pickFolder, notify, knownAgents, shared, setShared } from "herdr";
import { cfg, setSetting } from "./config.js";
import { pinOf, repoFolder, repoOf, git, spacesOn, tilde } from "./git.js";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const close = () => closeOverlay(props()?.overlay);

// Herdr's worktree dialog on a repository's folder ("new" or "open"). `start`:
// { argv, tab } for the new space's first terminal (an agent), else a shell.
function worktreeDialog(action, folder, machine, start = {}) {
  const open = action === "open";
  openOverlay({ mod: "worktree", kind: "dialog", width: open ? 560 : 460, height: open ? 480 : 280, props: { folder, machine: machine ?? null, action, ...start } });
}

// Asks what to start in a new space on a worktree, then opens it ("open") or
// goes on to Herdr's New worktree dialog ("new").
export function startPicker(p) {
  openOverlay({ mod: "sab-spaces", kind: "popup", width: 260, height: 380, props: { view: "start", ...p } });
}

// A new space on a checkout, its first terminal running `start`. machine "" is
// this computer (a click otherwise means the focused space's machine).
export function openSpace(folder, machine, start = {}) {
  run("space.new", { folder, machine: machine ?? "", ...start });
}

export function removeDialog(p) {
  openOverlay({ mod: "sab-spaces", kind: "dialog", width: 480, height: 300, props: { view: "remove", ...p } });
}

// Herdr's Rename space prompt, filled with the space's current name (Herdr's own
// space.rename leaves the field empty for a space nobody named). Empty still resets it.
function renameDialog(s) {
  openOverlay({ mod: "prompt", kind: "dialog", width: 380, height: 216, props: {
    title: "rename space", value: s.name, hint: "empty: named after its folder",
    command: { name: "space.rename", args: { id: s.id } },
  } });
}

function repoDialog(space, then) {
  openOverlay({ mod: "sab-spaces", kind: "dialog", width: 520, height: 440, props: { view: "repo", space, then } });
}

// Saves a space's pin (null removes it). Pins of closed spaces go at the same time.
async function pin(spaceId, folder) {
  const ids = new Set(spaces().map((s) => s.id));
  const repos = Object.fromEntries(Object.entries(cfg().spaces?.repos ?? {}).filter(([id]) => ids.has(id) && id !== spaceId));
  if (folder) repos[spaceId] = folder;
  await setSetting("spaces.repos", repos);
}

// ---- menus ---------------------------------------------------------------------

// A list of [label, icon, action] items ("-" separates), ↑/↓/Enter/Esc.
class Menu {
  init(cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(it) {
    if (!it?.[2]) return;
    close();
    it[2]();
  }

  render() {
    const t = theme();
    const list = this.items();
    const live = list.filter((it) => it !== "-" && it[2]);
    return v_flex().id("sab-space-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down" && live.length) this.at = (this.at + 1) % live.length;
        else if (e.key === "up" && live.length) this.at = (this.at + live.length - 1) % live.length;
        else if (e.key === "enter") this.choose(live[this.at]);
        else if (e.key === "escape") close();
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => it === "-"
        ? div().mx(7).my(4).h(1).bg(t.border)
        : h_flex().id(`mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center()
          .text_color(it[2] ? t.foreground : t.dim)
          .when(Boolean(it[2]) && live.indexOf(it) === this.at, (el) => el.bg(t.selected))
          .when(Boolean(it[2]), (el) => el.hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => this.choose(it)))
          .child(svg(ICON(it[1])).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().truncate().child(it[0]))));
  }
}

export class SpaceMenu extends Menu {
  init(cx, p) {
    super.init(cx);
    this.id = p.space;
    this.repo = undefined; // undefined: looking, null: not in git
    const s = this.space();
    const folder = s && repoFolder(s);
    cx.spawn(async (cx) => {
      this.repo = await repoOf(folder, s?.machine).catch(() => null);
      cx.notify();
    });
  }

  space() { return spaces().find((s) => s.id === this.id); }

  items() {
    const s = this.space();
    if (!s) return [["This space is gone", "x", null]];
    const r = this.repo, on = s.machine ?? null, pinned = pinOf(s);
    const local = !on;
    const repoItems = r === undefined
      ? [["Looking for its repository…", "git-branch", null]]
      : r
        ? [
          ["New worktree…", "git-branch", () => startPicker({ action: "new", folder: r.top, machine: on })],
          ["Open worktree…", "git-branch", () => worktreeDialog("open", r.top, on)],
          ...(r.linked ? [["Remove this worktree…", "x", () => removeDialog({ path: r.top, main: r.main, machine: on, branch: s.branch })]] : []),
        ]
        : local ? [["New worktree…", "git-branch", () => repoDialog(s.id, "new")]] : [];
    return [
      ["Rename", "square-pen", () => renameDialog(s)],
      "-",
      ...repoItems,
      ...(local ? [[pinned ? `Repository: ${pinned.split("/").pop()}…` : "Set repository…", "settings", () => repoDialog(s.id)]] : []),
      ...(pinned ? [["Unpin repository", "x", () => pin(s.id, null)]] : []),
      "-",
      ["Close", "x", () => run("space.close", { id: s.id })],
    ];
  }
}

export class WorktreeMenu extends Menu {
  init(cx, p) { super.init(cx); this.p = p; }
  items() {
    const p = this.p;
    return [
      ["Open in a new space…", "plus", () => startPicker({ action: "open", folder: p.path, machine: p.machine, branch: p.branch })],
      "-",
      ["Remove worktree…", "x", () => removeDialog(p)],
    ];
  }
}

// ---- buttons -------------------------------------------------------------------

function button(t, id, label, action, { primary = false, danger = false, disabled = false } = {}) {
  const fill = danger ? t.blocked : primary ? t.accent : t.raised;
  return div().id(id).h(28).px(12).flex().items_center().rounded(6).text_size(12.5).flex_none()
    .border_1().border_color(primary || danger ? fill : t.border)
    .bg(primary || danger ? fill : t.raised).text_color(primary || danger ? "#ffffff" : t.foreground)
    .when(disabled, (el) => el.opacity(0.5))
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => action(cx)))
    .child(label);
}

// ---- pick a repository ---------------------------------------------------------

export class RepoDialog {
  init(cx, p) {
    this.id = p.space;
    this.then = p.then ?? null;
    this.home = home();
    this.found = null; // repositories to offer, once read
    this.at = 0;
    this.error = "";
    this.busy = false;
    this.text = "";
    this.input = InputState.new({ placeholder: "filter, or type a path to a repository" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.at = 0; this.error = ""; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
    cx.spawn(async (cx) => { this.found = await this.suggestions(); cx.notify(); });
  }

  space() { return spaces().find((s) => s.id === this.id); }

  // Repositories near at hand: every local pane's, and other spaces' pins.
  async suggestions() {
    const folders = new Set([
      ...panes().filter((p) => p.cwd && spaces().some((s) => !s.machine && s.tabs?.some((c) => c.id === p.tab))).map((p) => p.cwd),
      ...Object.values(cfg().spaces?.repos ?? {}),
    ]);
    const out = new Map();
    for (const f of folders) {
      const r = await repoOf(f, null).catch(() => null);
      if (r) out.set(r.main, r);
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.found ?? []).filter((r) => !f || r.main.toLowerCase().includes(f));
  }

  submit(cx) {
    const typed = this.text.trim();
    if (/^[~/]/.test(typed)) return this.use(typed.replace(/^~(?=\/|$)/, this.home), cx);
    const r = this.shown()[this.at];
    if (r) this.use(r.main, cx);
  }

  choose(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Use this repository" });
      if (folder) this.use(folder, cx);
    });
  }

  // Pins the space to the folder's repository (its main checkout).
  use(folder, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await repoOf(folder, null);
        if (!r) { this.error = `${tilde(folder, this.home)} is not in a git repository.`; return; }
        await pin(this.id, r.main);
        close();
        if (this.then === "new") startPicker({ action: "new", folder: r.main, machine: null });
      } catch (e) { this.error = String(e?.message ?? e); }
      finally { this.busy = false; cx.notify(); }
    });
  }

  render() {
    const t = theme();
    const s = this.space();
    const rows = this.shown();
    const current = pinOf(s);
    const row = (r, i) => v_flex().id(`repo-${i}`).flex_none().h(42).px(10).justify_center().rounded(7).cursor_pointer()
      .when(i === this.at, (el) => el.bg(t.selected)).when(i !== this.at, (el) => el.hover((st) => st.bg(t.hover)))
      .on_click((_e, cx) => this.use(r.main, cx))
      .child(h_flex().gap(8).child(div().flex_1().truncate().text_color(t.foreground).child(r.name))
        .when(r.main === current, (el) => el.child(div().text_size(11).text_color(t.accent).child("pinned"))))
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(r.main, this.home)));
    return v_flex().id("sab-repo").size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const n = rows.length;
        if (e.key === "escape") return close();
        if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().font_semibold().text_color(t.foreground).child(`Repository for ${s?.name ?? "this space"}`))
      .child(div().text_color(t.muted).child(this.then === "new"
        ? "Pick the repository to make the worktree in. The space keeps it: its worktrees show under it."
        : "The space stands for this repository: its worktrees show under it, and its menu makes and removes them."))
      .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(t.accent).bg(t.background).text_color(t.foreground))
      .child(div().relative().flex_1().min_h(0)
        .child(v_flex().id("repo-list").size_full().overflow_y_scroll()
          .when(this.found === null, (el) => el.child(div().p(10).text_color(t.dim).child("…")))
          .when(this.found !== null && rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim)
            .child(this.found.length ? "No match. Type a path, or choose a folder." : "No repositories open in a pane. Choose a folder.")))
          .children(rows.map(row)))
        .child(Scrollbar.vertical("repo-list").absolute().inset_0()))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).items_center()
        .child(button(t, "repo-pick", "Choose folder…", (cx) => this.choose(cx), { disabled: this.busy }))
        .child(div().flex_1().text_size(11).text_color(t.dim).child(this.busy ? "working…" : "↵ use · esc cancel"))
        .child(button(t, "repo-cancel", "Cancel", () => close())));
  }
}

// ---- remove a worktree ---------------------------------------------------------

export class RemoveDialog {
  init(cx, p) {
    this.p = p;
    this.on = p.machine ?? null;
    this.home = this.on ? null : home();
    this.info = undefined; // undefined: looking, null: not a worktree
    this.dirty = 0;
    this.modules = false;
    this.dropBranch = false;
    this.busy = false;
    this.error = "";
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        const r = await repoOf(p.path, this.on);
        if (!r || !r.linked || r.top !== p.path) { this.info = null; cx.notify(); return; }
        const [status, branch, mods] = await Promise.all([
          git(p.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on),
          git(p.path, ["symbolic-ref", "--quiet", "--short", "HEAD"], this.on),
          git(p.path, ["config", "--file", ".gitmodules", "--get-regexp", "path"], this.on),
        ]);
        this.dirty = status.out ? status.out.split("\n").length : 0;
        this.modules = mods.ok && Boolean(mods.out);
        this.info = { ...r, branch: branch.ok ? branch.out : null };
      } catch (e) { this.info = null; this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  go(cx) {
    if (this.busy || !this.info) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.error = await this.remove(); } catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      if (!this.error) close();
      cx.notify();
    });
  }

  async remove() {
    const { path } = this.p, on = this.on, r = this.info;
    // Changes made since this opened get one more warning before they go.
    const status = await git(path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on);
    if (!status.ok) return status.err || "git status failed.";
    const now = status.out ? status.out.split("\n").length : 0;
    if (now > this.dirty) { this.dirty = now; return "It changed since this opened. Remove again to remove it anyway."; }
    // Terminals first: a shell sitting in the folder keeps it busy.
    const gone = spacesOn(path, on);
    for (const s of gone) run("space.close", { id: s.id, confirmed: true });
    const stale = Object.entries(cfg().spaces?.repos ?? {}).filter(([, f]) => f === path || f.startsWith(path + "/"));
    for (const [id] of stale) await setSetting("spaces.repos", Object.fromEntries(Object.entries(cfg().spaces.repos).filter(([k]) => k !== id)));
    // git refuses a worktree with changes or submodules unless forced.
    const force = this.dirty > 0 || this.modules;
    const rm = await git(r.main, ["worktree", "remove", ...(force ? ["--force"] : []), path], on);
    if (!rm.ok) return rm.err || "git worktree remove failed.";
    if (this.dropBranch && r.branch) {
      const b = await git(r.main, ["branch", "-d", r.branch], on);
      if (!b.ok) {
        notify({ title: "Worktree removed, branch kept", body: b.err || `git branch -d ${r.branch} failed.`, level: "warning" });
        return "";
      }
    }
    notify({ title: "Worktree removed", body: tilde(path, this.home), level: "success", timeout: 4000 });
    return "";
  }

  render() {
    const t = theme();
    const r = this.info, p = this.p;
    const name = r?.branch ?? p.branch ?? p.path.split("/").pop();
    const n = spacesOn(p.path, this.on).length;
    const detail = r === undefined ? "…"
      : r === null ? `${tilde(p.path, this.home)} is not a linked worktree (a repository's main checkout can't be removed here).`
        : `Deletes ${tilde(p.path, this.home)}${n ? ` and closes ${n === 1 ? "its space" : `its ${n} spaces`}` : ""}.${this.dropBranch ? "" : " The branch stays."}`;
    const box = h_flex().id("rm-branch").gap(8).items_center().cursor_pointer().text_color(t.muted)
      .on_click((_e, cx) => { this.dropBranch = !this.dropBranch; cx.notify(); })
      .child(h_flex().size(15).flex_none().rounded(4).border_1().items_center().justify_center()
        .border_color(this.dropBranch ? t.accent : t.border).bg(this.dropBranch ? t.accent : t.background)
        .when(this.dropBranch, (el) => el.child(svg("mods/sab-chrome/check.svg").size(11).text_color("#ffffff"))))
      .child(div().child(`Also delete the branch ${r?.branch ?? ""} (only if it's merged)`));
    return v_flex().id("sab-remove").track_focus(this.handle).size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") close();
        else if (e.key === "enter") this.go(cx);
      })
      .child(div().font_semibold().text_color(t.foreground).child(`Remove worktree ${name}?`))
      .child(div().text_color(t.muted).child(detail))
      .when(this.dirty > 0, (el) => el.child(div().text_color(t.blocked).child(`It has ${this.dirty} uncommitted change${this.dirty === 1 ? "" : "s"}: they will be lost.`)))
      .when(this.modules, (el) => el.child(div().text_color(t.blocked).child("It has submodules: anything not pushed in them goes with it.")))
      .when(Boolean(r?.branch), (el) => el.child(box))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child(this.busy ? "working…" : r ? "↵ remove · esc cancel" : "esc close"))
        .child(button(t, "rm-cancel", "Cancel", () => close()))
        .when(Boolean(r), (el) => el.child(button(t, "rm-go", "Remove", (cx) => this.go(cx), { danger: true, disabled: this.busy }))));
  }
}

// ---- what a new space starts with ------------------------------------------------

// The last agents each machine reported (Herdr's new-menu keeps them), shown at
// once while knownAgents() checks again; and the last choice, the default.
const KNOWN = "new-menu.agents";
const LAST = "sab.spaces.start";

export class StartPicker {
  init(cx, p) {
    this.p = p;
    this.on = p.machine ?? null;
    this.agents = shared(KNOWN)?.[this.on ?? ""] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.at = null;
    cx.spawn(async (cx) => {
      try { this.agents = await knownAgents({ on: this.on }); } catch { this.failed = true; }
      cx.notify();
    });
  }

  // Terminal first, then each installed agent: [key, name, icon el, start].
  choices(t) {
    const shell = ["shell", "Terminal", svg("icons/shell.svg").size(14).text_color(t.foreground), {}];
    return [shell, ...this.agents.filter((a) => a.installed).map((a) => [a.key, a.name,
      a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), { argv: a.run, tab: a.name }])];
  }

  choose(c) {
    if (!c) return;
    setShared(LAST, c[0]);
    close();
    const p = this.p;
    if (p.action === "new") worktreeDialog("new", p.folder, this.on, c[3]);
    else openSpace(p.folder, this.on, c[3]);
  }

  render() {
    const t = theme();
    const list = this.choices(t);
    if (this.at === null || this.at >= list.length) this.at = Math.max(0, list.findIndex((c) => c[0] === shared(LAST)));
    const title = this.p.action === "new" ? "New worktree, then start" : `Open ${this.p.branch ?? this.p.folder.split("/").pop()} with`;
    return v_flex().id("sab-start").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        const n = list.length;
        if (e.key === "down") this.at = (this.at + 1) % n;
        else if (e.key === "up") this.at = (this.at + n - 1) % n;
        else if (e.key === "enter") return this.choose(list[this.at]);
        else if (e.key === "escape") return close();
        else if (e.key === "t") return this.choose(list[0]);
        else if (/^[1-9]$/.test(e.key) && list[Number(e.key)]) return this.choose(list[Number(e.key)]);
        else return;
        cx.notify();
      })
      .child(div().px(9).pt(6).pb(4).text_size(11).text_color(t.dim).truncate().child(title))
      .children(list.map((c, i) => h_flex().id(`start-${c[0]}`).h(31).px(9).gap(10).rounded(7).items_center().flex_none().cursor_pointer()
        .text_color(t.foreground).when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click(() => this.choose(c))
        .child(c[2]).child(div().flex_1().truncate().child(c[1]))
        .child(div().text_size(11).text_color(t.dim).child(i === 0 ? "T" : i < 10 ? String(i) : ""))))
      .when(this.agents.length === 0, (el) => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…")));
  }
}
