// herdr-toolkit: what Claude Code loads as context for the focused pane's folder.
//
// - Instructions, always loaded: CLAUDE.md and CLAUDE.local.md (also .claude/CLAUDE.md)
//   in the folder and every parent, the project's .claude/rules/*.md, then the
//   user's ~/.claude/CLAUDE.md and ~/.claude/rules/*.md.
// - Auto memory: ~/.claude/projects/<folder with every non-alphanumeric as "-">/memory.
//   Worktrees share their main checkout's memory, so the folder is the main
//   checkout's when the pane is in a git worktree. MEMORY.md (the index) is
//   loaded every session; each memory file only when Claude recalls it.
//
// Each row shows its size in approximate tokens (characters / 4). Click one to
// read it here; the open-with button opens it in an editor. This computer only.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, watchFolder, theme, home, openOverlay } from "herdr";
import { location, key, markdownView, isShown, ICON } from "./lib.js";

const MAX_FILES = 200;
const tokens = (text) => Math.round(String(text ?? "").length / 4);
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const short = (p) => { const h = home(); return p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };
const parentOf = (p) => p.replace(/\/[^/]*$/, "") || "/";

// Claude Code's project folder name for a path: /Users/me/.x/y → -Users-me--x-y
export const projectDir = (path) => `${home()}/.claude/projects/${String(path).replace(/[^A-Za-z0-9]/g, "-")}`;

// The frontmatter fields of a memory file (name, description, type), if any.
export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? ""));
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const f = /^\s*(name|description|type):\s*(.*)$/.exec(line);
    if (f) out[f[1]] = f[2].trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\\(["'\\])/g, "$1").trim();
  }
  return out;
}

// *.md files directly in a folder, sorted; [] when there is none.
async function mdFiles(dir) {
  const r = await exec("find", [dir, "-mindepth", "1", "-maxdepth", "1", "-name", "*.md", "-type", "f"]).catch(() => null);
  return r?.code === 0 ? r.stdout.split("\n").filter(Boolean).sort().slice(0, MAX_FILES) : [];
}

async function read(path) {
  const text = await readTextFile(path).catch(() => null);
  return text === null || text.includes("\0") ? null : text;
}

export class Memory {
  init(cx) {
    this.sections = []; this.file = null; this.text = null;
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (!isShown(this.id)) { this.stale = true; return; }
    this.stale = false;
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) { this.context = context; this.sections = []; this.file = null; this.text = null; this.error = null; this.watched = null; }
    if (on) { this.error = `The pane is on ${on}: memory is read on this computer only`; cx.notify(); return; }
    if (!cwd) { this.error = "No folder"; cx.notify(); return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const sections = await this.read(cwd);
        if (key() !== context) return;
        this.sections = sections; this.error = null;
        if (this.file) this.text = sections.flatMap((s) => s.items).find((i) => i.path === this.file)?.text ?? this.text;
        this.watch(this.memoryDir, cx);
      } catch (e) { if (key() === context) this.error = String(e?.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async read(cwd) {
    const h = home(), user = `${h}/.claude`;
    // The main checkout: worktrees keep their memory there.
    const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }).catch(() => null);
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd }).catch(() => null);
    const commonDir = common?.code === 0 ? common.stdout.trim() : null;
    const main = commonDir?.endsWith("/.git") ? commonDir.slice(0, -5) : null;
    const root = top?.code === 0 ? top.stdout.trim() : null;

    // Instructions in the folder and every parent (nearest last, as Claude reads them).
    const dirs = [];
    for (let d = cwd.replace(/\/+$/, "") || "/"; ; d = parentOf(d)) { dirs.unshift(d); if (d === "/") break; }
    const project = [];
    for (const d of dirs) {
      if (d === user || d === h + "/.claude") continue;
      for (const name of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
        const path = `${d === "/" ? "" : d}/${name}`, text = await read(path);
        if (text !== null) project.push({ path, label: `${short(d)}/${name}`, text, note: name.includes("local") ? "local, not committed" : null });
      }
    }
    for (const path of await mdFiles(`${root ?? cwd}/.claude/rules`)) {
      const text = await read(path);
      if (text !== null) project.push({ path, label: `rules/${path.split("/").pop()}`, text, note: "project rule" });
    }

    const userItems = [];
    const userMd = await read(`${user}/CLAUDE.md`);
    if (userMd !== null) userItems.push({ path: `${user}/CLAUDE.md`, label: "~/.claude/CLAUDE.md", text: userMd });
    for (const path of await mdFiles(`${user}/rules`)) {
      const text = await read(path);
      if (text !== null) userItems.push({ path, label: `rules/${path.split("/").pop()}`, text });
    }

    // Auto memory: the main checkout's, else the repo's, else the folder's.
    let memDir = null;
    for (const p of [main, root, cwd].filter(Boolean)) {
      const d = `${projectDir(p)}/memory`;
      if ((await mdFiles(d)).length) { memDir = d; break; }
    }
    this.memoryDir = memDir;
    const memory = [], recalled = [];
    if (memDir) {
      for (const path of await mdFiles(memDir)) {
        const text = await read(path);
        if (text === null) continue;
        const name = path.split("/").pop();
        if (name === "MEMORY.md") { memory.push({ path, label: "MEMORY.md", text, note: "index, loaded every session" }); continue; }
        const f = frontmatter(text);
        recalled.push({ path, label: f.name || name.replace(/\.md$/, ""), text, note: f.description || null, type: f.type || null });
      }
    }

    return [
      { id: "project", title: "Project instructions", about: "Loaded every session", items: project, empty: "No CLAUDE.md in this folder or its parents" },
      { id: "user", title: "Your instructions", about: "Loaded in every project", items: userItems, empty: "No ~/.claude/CLAUDE.md or rules" },
      { id: "memory", title: "Auto memory", about: memDir ? short(memDir) : null, items: [...memory, ...recalled],
        empty: "No memory saved for this project yet", recalled: recalled.length },
    ];
  }

  watch(dir, cx) {
    if (!dir || this.watched === dir) return;
    this.watched = dir;
    cx.spawn(async (cx) => {
      try { while (this.watched === dir) { await watchFolder(dir); if (this.watched === dir && isShown(this.id)) this.refresh(cx); } }
      catch { if (this.watched === dir) this.watched = null; }
    });
  }

  open(item) { this.file = item.path; this.text = item.text; this.label = item.label; }

  openWith() {
    openOverlay({ mod: "sab-open-with", kind: "popup", width: 340, props: { file: this.file, folder: parentOf(this.file), machine: null } });
  }

  row(item, i, t) {
    return h_flex().id(`mem-${item.path}`).min_h(30).flex_none().px(8).py(5).gap(8).items_start().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(short(item.path))
      .on_click((_e, cx) => { this.open(item); cx.notify(); })
      .child(svg(`${ICON}file-text.svg`).size(14).flex_none().mt(2).text_color(t.muted))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().min_w(0).truncate().child(item.label))
          .when(Boolean(item.type), (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.foreground + "14").text_size(10.5).text_color(t.muted).child(item.type))))
        .when(Boolean(item.note), (el) => el.child(div().text_size(11.5).text_color(t.dim).truncate().child(item.note))))
      .child(div().flex_none().mt(2).text_size(11).text_color(t.dim).child(`~${fmt(tokens(item.text))}`));
  }

  section(s, t) {
    const total = s.items.filter((i) => s.id !== "memory" || i.label === "MEMORY.md").reduce((n, i) => n + tokens(i.text), 0);
    const head = h_flex().h(30).flex_none().px(8).gap(8).items_center().text_size(11.5).text_color(t.dim)
      .child(div().font_semibold().text_color(t.muted).child(s.title))
      .child(div().flex_1().min_w(0).truncate().child(s.about ?? ""))
      .when(total > 0, (el) => el.child(div().flex_none().tooltip("Approximate tokens loaded every session (characters / 4)").child(`~${fmt(total)} tok`)));
    return v_flex().flex_none().gap(1).pb(8)
      .child(head)
      .children(s.items.length ? s.items.map((item, i) => this.row(item, i, t)) : [div().px(8).py(4).text_size(12).text_color(t.dim).child(s.empty)])
      .when(s.recalled > 0, (el) => el.child(div().px(8).pt(2).text_size(11).text_color(t.dim).child(`${s.recalled} memories, read only when Claude recalls them`)));
  }

  render(cx) {
    if (isShown(this.id) && (this.stale || key() !== this.context)) this.refresh(cx);
    const t = theme();
    const button = (id, icon, tip, action) => div().id(id).p(4).rounded(6).cursor_pointer().text_color(t.muted).tooltip(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => action(cx)).child(svg(`${ICON}${icon}.svg`).size(14));
    const always = this.sections.flatMap((s) => s.items.filter((i) => s.id !== "memory" || i.label === "MEMORY.md")).reduce((n, i) => n + tokens(i.text), 0);
    const header = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .when(Boolean(this.file), (el) => el.child(div().id("mem-back").w(20).cursor_pointer().text_color(t.muted)
        .on_click((_e, cx) => { this.file = null; this.text = null; cx.notify(); }).child("←")))
      .child(div().font_semibold().child(this.file ? this.label : "Memory"))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
        .child(this.file ? short(parentOf(this.file)) : always ? `~${fmt(always)} tokens every session` : ""))
      .when(Boolean(this.file), (el) => el.child(button("mem-open-with", "open-with", "Open with…", () => this.openWith())))
      .when(!this.file, (el) => el.child(button("mem-refresh", "refresh", "Read again", (cx) => this.refresh(cx))));
    return v_flex().id("memory").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header)
      .child(this.file ? markdownView("memory-md", this.text ?? "", t)
        : v_flex().id("memory-list").flex_1().min_h(0).p(6).overflow_y_scrollbar()
          .when(Boolean(this.error), (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error)))
          .when(!this.error && !this.sections.length, (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.loading ? "Reading…" : "")))
          .children(this.error ? [] : this.sections.map((s) => this.section(s, t))));
  }
}
