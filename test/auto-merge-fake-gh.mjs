// A stand-in for `gh`, for the replays of auto-merge's merge steps in install.test.mjs. It answers the few REST calls
// those steps make from a scratch git repository, whose `main` is the base branch, and performs the merge there.
// Started as `gh` from a PATH directory (a wrapper execs this file with node). Scenario from the environment:
//   SCEN_REPO       the git repository
//   SCEN_HEAD       the pull request's head commit
//   SCEN_BASE_SHA   the pull request's stored base.sha (GitHub does not move it when the base branch moves)
//   SCEN_PR_MB      where `changed_files` is counted from: "stored" = the merge base of SCEN_BASE_SHA and the head,
//                   "tip" = the merge base of main and the head (GitHub's count has been seen to follow either)
//   SCEN_AUTHOR     the pull request's author
//   SCEN_STATE      a JSON file holding whether this stand-in merged the pull request, and the merge commit
//   SCEN_LOG        a file every call is appended to, one JSON array of arguments per line
// Served: GET pulls/N, git/ref/heads/main, git/commits/<sha>, compare/<a>...<b> (files cut at 300, commits at 250,
// as the API does), and PUT pulls/N/merge (pinned to `sha`; squash or merge, both written as one commit on main
// from `git merge-tree`, which starts from a virtual base when there are two). Anything else is a 404.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const env = process.env;
const args = process.argv.slice(2);
fs.appendFileSync(env.SCEN_LOG, `${JSON.stringify(args)}\n`);
const die = (message) => { process.stderr.write(`${message}\n`); process.exit(1); };
const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_AUTHOR_DATE: "2026-06-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-06-01T00:00:00Z" };
const git = (...a) => execFileSync("git", ["-C", env.SCEN_REPO, ...a], { encoding: "utf8", env: { ...env, ...ID } }).trim();
const tryGit = (...a) => { const r = spawnSync("git", ["-C", env.SCEN_REPO, ...a], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };

if (args[0] !== "api") die(`fake gh: only \`gh api\` is served, not: gh ${args.join(" ")}`);
let jq = null, method = "GET", target = null;
const fields = {};
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--jq") jq = args[++i];
  else if (a === "--method" || a === "-X") method = args[++i];
  else if (a === "-f" || a === "-F") { const [k, ...v] = args[++i].split("="); fields[k] = v.join("="); }
  else if (target === null && !a.startsWith("-")) target = a;
  else die(`fake gh: unexpected argument ${a}`);
}
const route = /^repos\/o\/r\/(.+)$/.exec(target ?? "")?.[1] ?? die(`fake gh: not this repository: ${target}`);
const notFound = () => die(`gh: Not Found (HTTP 404)`);
const state = JSON.parse(fs.readFileSync(env.SCEN_STATE, "utf8"));
const head = env.SCEN_HEAD;
const tip = () => git("rev-parse", "main");
const commitOf = (rev) => tryGit("rev-parse", "--verify", "--quiet", `${rev}^{commit}`) ?? notFound();

// The files between two commits as the compare API lists them: renames found, `previous_filename` on a rename.
function files(base, to) {
  const rows = [];
  const status = git("diff", "-M", "--name-status", "-z", base, to).split("\0");
  const numstat = git("diff", "-M", "--numstat", "-z", base, to).split("\0");
  for (let i = 0, n = 0; i < status.length - 1;) {
    const s = status[i++];
    const row = s.startsWith("R") ? { previous_filename: status[i++], filename: status[i++], status: "renamed" } : { filename: status[i++], status: { A: "added", D: "removed", T: "changed" }[s[0]] ?? "modified" };
    // numstat -z: "added\tdeleted\tpath" or, for a rename, "added\tdeleted\t" then the two paths.
    const [added, deleted, p] = numstat[n++].split("\t");
    if (p === "") n += 2;
    rows.push({ ...row, additions: added === "-" ? 0 : Number(added), deletions: deleted === "-" ? 0 : Number(deleted) });
  }
  return rows;
}

let body;
let m;
if (method === "PUT" && (m = /^pulls\/(\d+)\/merge$/.exec(route))) {
  if (state.merged) die("gh: Pull Request is not mergeable (HTTP 405)");
  if (fields.sha !== head) die("gh: Head branch was modified. Review and try the merge again. (HTTP 409)");
  const from = tip();
  const merged = spawnSync("git", ["-C", env.SCEN_REPO, "merge-tree", "--write-tree", from, head], { encoding: "utf8" });
  if (merged.status !== 0) die("gh: Pull Request is not mergeable (HTTP 405)");
  const commit = git("commit-tree", merged.stdout.split("\n")[0], "-p", from, ...(fields.merge_method === "merge" ? ["-p", head] : []), "-m", `${fields.merge_method} of #${m[1]}`);
  git("update-ref", "refs/heads/main", commit, from);
  fs.writeFileSync(env.SCEN_STATE, JSON.stringify({ merged: true, sha: commit }));
  body = { sha: commit, merged: true, message: "Pull Request successfully merged" };
} else if (method !== "GET") {
  die(`fake gh: ${method} ${route} is not served`);
} else if ((m = /^pulls\/(\d+)$/.exec(route))) {
  const countedFrom = git("merge-base", env.SCEN_PR_MB === "tip" ? tip() : env.SCEN_BASE_SHA, head);
  body = {
    number: Number(m[1]), state: state.merged ? "closed" : "open", merged: state.merged, merge_commit_sha: state.sha ?? null,
    merged_by: state.merged ? { login: "github-actions[bot]" } : null,
    base: { ref: "main", sha: env.SCEN_BASE_SHA }, head: { sha: head }, user: { login: env.SCEN_AUTHOR },
    changed_files: files(countedFrom, head).length,
  };
} else if ((m = /^git\/ref\/heads\/(.+)$/.exec(route))) {
  if (m[1] !== "main") notFound();
  body = { ref: "refs/heads/main", object: { sha: tip(), type: "commit" } };
} else if ((m = /^git\/commits\/([0-9a-f]{40})$/.exec(route))) {
  const [sha, ...parents] = git("rev-list", "--parents", "-n", "1", commitOf(m[1])).split(" ");
  body = { sha, parents: parents.map((p) => ({ sha: p })) };
} else if ((m = /^compare\/([^.]+)\.\.\.([^.]+)$/.exec(route))) {
  const [a, b] = [commitOf(m[1]), commitOf(m[2])];
  const base = git("merge-base", a, b);
  const commits = git("rev-list", "--reverse", `${a}..${b}`).split("\n").filter(Boolean);
  body = {
    merge_base_commit: { sha: base }, total_commits: commits.length,
    commits: commits.slice(0, 250).map((c) => ({ sha: c, author: { login: env.SCEN_AUTHOR }, commit: { message: git("log", "-1", "--format=%B", c) } })),
    files: files(base, b).slice(0, 300),
  };
} else {
  notFound();
}

const text = JSON.stringify(body);
if (jq === null) { process.stdout.write(`${text}\n`); process.exit(0); }
// gh --jq prints strings raw, as jq -r does.
const r = spawnSync("jq", ["-r", jq], { input: text, encoding: "utf8" });
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
process.exit(r.status ?? 1);
