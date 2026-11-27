// Jira ticket titles, for tab names, tab tooltips and the spaces sidebar.
//
// A mod asks for a key while drawing (`jiraTitle(key)`: the title it has, or
// null) and fetches what was asked for from a timer (`fetchJiraTitles()`).
// Titles are kept in shared "sab.jira.titles" ({ KEY: { title, status, at } or
// { error, at } }), so every mod sees a title any of them fetched; sab-tabs
// also keeps them in its localStorage across restarts.
//
// It calls <jira.baseUrl>/rest/api/3/issue/KEY?fields=summary,status with curl,
// which reads the login from a netrc file (jira.netrc):
//   machine your-site.atlassian.net login you@example.com password <API token>
// so the token never shows in a process list. Nothing is fetched without the file.
//
// Herdr does not let a mod import another mod's files, so this file is copied
// into each mod by scripts/sync-shared.sh. Edit sab/shared/jira.js only.
import { exec, home, readTextFile, shared, setShared, notify } from "herdr";
import { cfg, jiraSite } from "./config.js";

export const TITLES_KEY = "sab.jira.titles";
const PER_TICK = 8, KEEP_N = 300, RETRY_MS = 10 * 60000;

const wanted = new Set(), busy = new Set();
let told = null, netrcAt = 0, netrcOk = false;

const expand = (p) => (p === "~" ? home() : String(p).startsWith("~/") ? home() + String(p).slice(1) : String(p));
const on = () => Boolean(cfg().jira?.titles && jiraSite());
const fresh = (e) => e && Date.now() - e.at < (e.error ? RETRY_MS : Math.max(1, cfg().jira?.refreshMinutes ?? 30) * 60000);

// The title known for a key, or null; asks for it when it is missing or old.
export function jiraTitle(key) {
  if (!key || !on()) return null;
  const e = shared(TITLES_KEY)?.[key];
  if (!fresh(e)) wanted.add(key);
  return e?.title ?? null;
}
export const wantJira = (key) => { if (key && on()) wanted.add(key); };

// sab-tabs: the titles it kept from last time, when nobody has published any yet.
export function loadJiraCache() {
  if (shared(TITLES_KEY)) return;
  try { const kept = JSON.parse(localStorage.getItem("jira.titles") ?? "null"); if (kept && typeof kept === "object") setShared(TITLES_KEY, kept); } catch {}
}

// Fetches up to a few asked-for titles. `tell`: notify once when the login is
// missing or refused (only sab-tabs does, so there is one toast, not one per mod).
export async function fetchJiraTitles({ tell = false, persist = false } = {}) {
  if (!on() || !wanted.size) return false;
  const site = jiraSite(), netrc = expand(cfg().jira?.netrc ?? "");
  if (Date.now() - netrcAt > 30000) {
    netrcAt = Date.now();
    netrcOk = Boolean(netrc && await readTextFile(netrc).catch(() => null));
  }
  if (!netrcOk) {
    if (tell && told !== "netrc") { told = "netrc"; notify({ title: "Jira titles need a login", body: `Put "machine ${site.replace(/^https:\/\//, "")} login <email> password <API token>" in ${netrc || "the jira.netrc file"}.` }); }
    wanted.clear();
    return false;
  }
  const keys = [...wanted].filter((k) => !busy.has(k) && !fresh(shared(TITLES_KEY)?.[k])).slice(0, PER_TICK);
  for (const k of keys) wanted.delete(k);
  if (!keys.length) return false;
  const got = {};
  await Promise.all(keys.map(async (k) => {
    busy.add(k);
    try {
      const r = await exec("curl", ["-sS", "--max-time", "10", "--netrc-file", netrc, "-H", "Accept: application/json",
        "-w", "\n%{http_code}", `${site}/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary,status`]).catch(() => null);
      const out = r?.stdout ?? "", cut = out.lastIndexOf("\n"), code = Number(out.slice(cut + 1));
      if (code === 200) {
        const f = JSON.parse(out.slice(0, cut)).fields ?? {};
        got[k] = { title: String(f.summary ?? "").trim() || null, status: f.status?.name ?? null, at: Date.now() };
      } else {
        got[k] = { error: code ? `HTTP ${code}` : (r?.stderr || "curl failed").trim(), at: Date.now() };
        if (tell && (code === 401 || code === 403) && told !== "auth") {
          told = "auth";
          notify({ title: "Jira refused the login", body: `HTTP ${code} from ${site}. Check the email and API token in ${netrc}.`, level: "warning" });
        }
      }
    } catch (e) { got[k] = { error: String(e?.message ?? e), at: Date.now() }; }
    finally { busy.delete(k); }
  }));
  // Keep an older title when a refresh failed.
  const now = { ...(shared(TITLES_KEY) ?? {}) };
  for (const [k, v] of Object.entries(got)) now[k] = v.error && now[k]?.title ? { ...now[k], at: v.at } : v;
  const kept = Object.fromEntries(Object.entries(now).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_N));
  setShared(TITLES_KEY, kept);
  if (persist) try { localStorage.setItem("jira.titles", JSON.stringify(kept)); } catch {}
  return true;
}
