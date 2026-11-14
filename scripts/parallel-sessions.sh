#!/usr/bin/env bash
# Where this branch stands, in a repository several sessions work in at once
# (docs/conventions/parallel-sessions.md).
#
#   ./scripts/parallel-sessions.sh             fetch the remote's branches, then report
#   ./scripts/parallel-sessions.sh --no-fetch  report against the last fetched state
#   ./scripts/parallel-sessions.sh --check     one line when this branch is behind the
#                                              default branch as last fetched — first of
#                                              all when that branch changed files this
#                                              one also changes; nothing otherwise.
#                                              Never fetches. (guard PS-2)
#
# It reads refs, which every worktree of a repository shares, and the
# remote-tracking refs of the branches pushed from elsewhere — another
# machine, a session in the cloud — which no worktree here holds: it sees
# what the other branches have committed, never what a session has not
# committed, nor what another machine has not pushed. It writes nothing of
# its own: no ref, no index, no file of a working tree. What moves is what
# `git fetch --prune` moves, the remote-tracking refs of the remote's
# branches; the trial merges are made in memory, their objects in a
# temporary directory. Branch names, paths and file names come from the
# repository: they are printed, never evaluated.
set -uo pipefail

default="main"
remote=origin
mode=report
fetch=true
for arg in "$@"; do
  case "$arg" in
    --no-fetch) fetch=false ;;
    --check) mode=check; fetch=false ;;
    *) echo "usage: $0 [--no-fetch | --check]" >&2; exit 2 ;;
  esac
done

# --check speaks only when it has a finding: every other way out is silent.
bye() { [ "$mode" = check ] || echo "parallel-sessions: $1"; exit 0; }
count() { wc -l < "$1" | tr -d ' '; }
sorted() { LC_ALL=C sort -u; }
# The first names of a list, on one line.
names() { awk 'NR <= 8 { printf "%s%s", (NR > 1 ? ", " : ""), $0 } END { if (NR > 8) printf " … and %d more", NR - 8 }' "$1"; }
# A path as git recorded it, without the control characters a directory name may hold.
printable() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177'; }

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  [ "$mode" = check ] && exit 0
  echo "parallel-sessions: not inside a git working tree" >&2
  exit 1
fi
top=$(git rev-parse --show-toplevel) || exit 1
cd "$top" || exit 1
git rev-parse -q --verify HEAD >/dev/null 2>&1 || bye "no commit yet, nothing to compare"

tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT

# Never wait for a password or a passphrase: a report that hangs is worse than
# an old one. A transport the user configured is left as it is.
# Every branch of the remote, not only the default one: a session in the
# cloud or on another machine shows here only through what it pushed.
# --prune forgets the branches deleted there, so that a merged and deleted
# branch is not reported as work in progress.
fetch_remote() {
  local spec="+refs/heads/*:refs/remotes/$remote/*"
  if [ -z "${GIT_SSH_COMMAND:-}" ] && ! git config --get core.sshCommand >/dev/null 2>&1; then
    GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes" git fetch --quiet --prune "$remote" "$spec" </dev/null >/dev/null 2>&1
  else
    GIT_TERMINAL_PROMPT=0 git fetch --quiet --prune "$remote" "$spec" </dev/null >/dev/null 2>&1
  fi
}

seen="as last fetched"
if [ "$fetch" = true ] && git remote get-url "$remote" >/dev/null 2>&1; then
  if fetch_remote; then seen="fetched just now"; else seen="as last fetched: $remote could not be reached"; fi
fi
if git rev-parse -q --verify "refs/remotes/$remote/$default" >/dev/null 2>&1; then
  base="refs/remotes/$remote/$default"; base_name="$remote/$default"
elif git rev-parse -q --verify "refs/heads/$default" >/dev/null 2>&1; then
  base="refs/heads/$default"; base_name="$default"; seen="the local branch: there is no $remote/$default"
else
  bye "neither $remote/$default nor $default exists, nothing to compare with"
fi
fork=$(git merge-base HEAD "$base" 2>/dev/null) || fork=""
[ -n "$fork" ] || bye "no common ancestor with $base_name in this clone (a shallow clone?), nothing to compare"

# What this branch changes: its commits since the fork, and what is not committed yet.
git diff --no-renames --name-only "$fork" HEAD 2>/dev/null | sorted > "$tmp/committed"
{ git diff --no-renames --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sorted > "$tmp/pending"
cat "$tmp/committed" "$tmp/pending" | sorted > "$tmp/mine"
git diff --no-renames --name-only "$fork" "$base" 2>/dev/null | sorted > "$tmp/base"
comm -12 "$tmp/mine" "$tmp/base" > "$tmp/stale"
stale=$(count "$tmp/stale")

# How to catch up. A rebase rewrites the commits of the branch, so it is for
# commits nobody else has. "Pushed" means the remote copy of the branch holds
# commits the default branch lacks: a branch whose earlier commits were all
# merged has nothing a rebase would rewrite. A pushed branch takes a merge.
me=$(git symbolic-ref -q HEAD 2>/dev/null) || me=""
behind=$(git rev-list --count "HEAD..$base")
pushed=0
if [ -n "$me" ] && git rev-parse -q --verify "refs/remotes/$remote/${me#refs/heads/}" >/dev/null 2>&1; then
  pushed=$(git rev-list --count "$base..refs/remotes/$remote/${me#refs/heads/}" 2>/dev/null) || pushed=0
fi
if [ -z "$me" ]; then
  how="rebase on $base_name, or merge it once commits of the branch are pushed"
elif [ "$pushed" -gt 0 ]; then
  how="git merge $base_name (commits of the branch are pushed: a rebase would need a forced push)"
else
  how="git rebase $base_name (no commit of the branch is pushed)"
fi

if [ "$mode" = check ]; then
  if [ "$stale" -gt 0 ]; then
    printf '%s, as last fetched, changed %s file(s) this branch also changes (%s): catch up before you push — %s\n' "$base_name" "$stale" "$(names "$tmp/stale")" "$how"
  elif [ "$behind" -gt 0 ]; then
    printf '%s, as last fetched, is %s commit(s) ahead of this branch: catch up before a pull request — %s\n' "$base_name" "$behind" "$how"
  fi
  exit 0
fi

if [ -n "$me" ]; then label=${me#refs/heads/}; else label="a detached HEAD at $(git rev-parse --short HEAD)"; fi
ahead=$(git rev-list --count "$base..HEAD")
printf 'parallel-sessions: %s\n' "$label"
printf 'base: %s at %s (%s)\n\n' "$base_name" "$(git rev-parse --short "$base")" "$seen"
printf 'this branch: %s commit(s) behind %s, %s of its own, %s file(s) changed, uncommitted ones included\n' "$behind" "$base_name" "$ahead" "$(count "$tmp/mine")"
if [ "$stale" -gt 0 ]; then
  printf '  CATCH UP NOW: %s changed %s file(s) this branch also changes: %s\n' "$base_name" "$stale" "$(names "$tmp/stale")"
  printf '  how: commit, then %s\n' "$how"
elif [ "$behind" -gt 0 ]; then
  printf '  what %s changed since the fork touches none of the files this branch changes\n' "$base_name"
  printf '  before a pull request, catch up all the same: %s\n' "$how"
else
  printf '  up to date with %s\n' "$base_name"
fi
if [ "$base" != "refs/heads/$default" ] && git rev-parse -q --verify "refs/heads/$default" >/dev/null 2>&1; then
  lag=$(git rev-list --count "refs/heads/$default..$base")
  [ "$lag" -gt 0 ] && printf 'the local %s is %s commit(s) behind %s: a branch or a worktree cut from it starts that far behind\n' "$default" "$lag" "$base_name"
fi

# A trial merge of two commits, in memory: prints the resulting tree, then the
# paths in conflict; exits 0 when clean, 1 on a conflict. New objects go to a
# temporary directory, so the repository's object store is only read.
objects=$(git rev-parse --git-path objects 2>/dev/null) || objects=""
case "$objects" in /*) ;; *) objects="$PWD/$objects" ;; esac
mkdir "$tmp/objects"
trial() {
  GIT_OBJECT_DIRECTORY="$tmp/objects" GIT_ALTERNATE_OBJECT_DIRECTORIES="$objects" \
    git merge-tree --write-tree --name-only --no-messages "$1" "$2" </dev/null 2>/dev/null
}
forecast=false
trial HEAD HEAD >/dev/null && forecast=true # git 2.38 or later
base_tree=$(git rev-parse "$base^{tree}")

: > "$tmp/held"
: > "$tmp/idle"
detached=0
sibling() { # $1 what follows the name (a worktree's path), $2 the ref of its branch,
           # then, for a pushed branch: $3 the name to print, $4 and $5 the files that
           # take a branch that holds changes and one with nothing left to merge
  local ref="$2" name="${3:-${2#refs/heads/}}" held="${4:-$tmp/held}" idle="${5:-$tmp/idle}" sfork sbehind sahead out changed common late
  git rev-parse -q --verify "$ref" >/dev/null 2>&1 </dev/null || return 0
  sfork=$(git merge-base "$ref" "$base" 2>/dev/null </dev/null) || return 0
  sbehind=$(git rev-list --count "$ref..$base" </dev/null)
  sahead=$(git rev-list --count "$base..$ref" </dev/null)
  git diff --no-renames --name-only "$sfork" "$ref" 2>/dev/null </dev/null | sorted > "$tmp/theirs"
  changed=$(count "$tmp/theirs")
  # Nothing left to merge: no change since its fork, or changes the base already holds (a squash merge).
  if [ "$changed" -gt 0 ] && [ "$forecast" = true ]; then
    out=$(trial "$base" "$ref") && [ "${out%%$'\n'*}" = "$base_tree" ] && changed=0
  fi
  if [ "$changed" -eq 0 ]; then
    printf '  %s, %s commit(s) behind — %s\n' "$name" "$sbehind" "$(printable "$1")" >> "$idle"
    return 0
  fi
  {
    printf '  %s — %s\n' "$name" "$(printable "$1")"
    printf '      %s commit(s) of its own on %s file(s), %s behind %s\n' "$sahead" "$changed" "$sbehind" "$base_name"
    git diff --no-renames --name-only "$sfork" "$base" 2>/dev/null </dev/null | sorted > "$tmp/sbase"
    late=$(comm -12 "$tmp/theirs" "$tmp/sbase" | wc -l | tr -d ' ')
    [ "$late" -gt 0 ] && printf '      %s changed %s of its file(s) since it forked: it has a merge to do\n' "$base_name" "$late"
    comm -12 "$tmp/mine" "$tmp/theirs" > "$tmp/common"
    common=$(count "$tmp/common")
    if [ "$common" -eq 0 ]; then
      printf '      no file in common with this branch\n'
    else
      printf '      %s file(s) in common with this branch: %s\n' "$common" "$(names "$tmp/common")"
      # The forecast merges commits: it is made only when a commit of this branch holds one of those files.
      comm -12 "$tmp/common" "$tmp/committed" > "$tmp/seen"
      comm -12 "$tmp/common" "$tmp/pending" > "$tmp/unseen"
      if [ "$forecast" = true ] && [ -s "$tmp/seen" ]; then
        if out=$(trial HEAD "$ref"); then
          printf '      merging the two is clean as text (committed work only; it says nothing of whether the result works)\n'
        else
          printf '%s\n' "$out" | sed -e 1d -e '/^$/d' | sorted > "$tmp/conflicts"
          if [ -s "$tmp/conflicts" ]; then
            printf '      merging the two CONFLICTS in: %s\n' "$(names "$tmp/conflicts")"
          else
            printf '      the two could not be merged in memory\n'
          fi
        fi
      fi
      [ -s "$tmp/unseen" ] && printf '      your changes to %s of them are not committed, and no forecast covers them: %s\n' "$(count "$tmp/unseen")" "$(names "$tmp/unseen")"
    fi
  } >> "$held"
}

self=$(pwd -P)
wt=""; ref=""; bare=false
record() {
  [ -n "$ref" ] && printf '%s\n' "$ref" >> "$tmp/local"
  if [ -n "$wt" ] && [ "$wt" != "$self" ] && [ "$bare" = false ] && [ "$ref" != "$me" ]; then
    if [ -z "$ref" ]; then detached=$((detached + 1)); elif [ "$ref" != "refs/heads/$default" ]; then sibling "$wt" "$ref"; fi
  fi
  wt=""; ref=""; bare=false
}
: > "$tmp/local"
git worktree list --porcelain > "$tmp/worktrees" 2>/dev/null
while IFS= read -r line; do
  case "$line" in
    "worktree "*) record; wt=${line#worktree } ;;
    "branch "*) ref=${line#branch } ;;
    bare) bare=true ;;
    "") record ;;
  esac
done < "$tmp/worktrees"
record

# The branches pushed from elsewhere — another machine, a session in the
# cloud, or a branch nobody works on now — that no worktree here holds,
# compared the same way, the most recent first. Ten are shown in full; those
# with nothing left to merge are only counted.
: > "$tmp/pheld"
: > "$tmp/pidle"
pushed_seen=false
git for-each-ref --sort=-committerdate --format='%(refname)' "refs/remotes/$remote/" > "$tmp/pushed" 2>/dev/null
while IFS= read -r rref; do
  rname=${rref#"refs/remotes/$remote/"}
  case "$rname" in HEAD|"$default") continue ;; esac
  pushed_seen=true
  # The branch of a worktree here, this one's included, is compared as a worktree or not at all.
  grep -qxF "refs/heads/$rname" "$tmp/local" && continue
  sibling "pushed, last commit $(git log -1 --format=%cr "$rref" 2>/dev/null </dev/null)" "$rref" "$remote/$rname" "$tmp/pheld" "$tmp/pidle"
done < "$tmp/pushed"

if [ -s "$tmp/held" ]; then
  printf '\nother worktrees whose branch holds changes:\n'
  cat "$tmp/held"
fi
if [ -s "$tmp/idle" ]; then
  printf '\nother worktrees with nothing left to merge — merged already, or nothing committed yet:\n'
  cat "$tmp/idle"
fi
[ -s "$tmp/held" ] || [ -s "$tmp/idle" ] || printf '\nno other worktree on a branch of its own\n'
[ "$detached" -gt 0 ] && printf '%s other worktree(s) on a detached HEAD: not compared\n' "$detached"
if [ -s "$tmp/pheld" ]; then
  shown=10
  total=$(grep -c '^  [^ ]' "$tmp/pheld")
  printf '\nbranches pushed to %s with work of their own, no worktree here — another machine, a session in the cloud, or nobody now:\n' "$remote"
  awk -v max="$shown" '/^  [^ ]/ { n++ } n <= max' "$tmp/pheld"
  [ "$total" -gt "$shown" ] && printf '  … and %s more, older\n' "$((total - shown))"
fi
if [ -s "$tmp/pidle" ]; then
  sed -E 's/^  ([^,]*),.*/\1/' "$tmp/pidle" > "$tmp/pidle-names"
  printf '%s other pushed branch(es) with nothing left to merge: %s\n' "$(count "$tmp/pidle")" "$(names "$tmp/pidle-names")"
fi
[ "$pushed_seen" = true ] || printf 'no branch of %s but %s, as last fetched\n' "$remote" "$default"
[ "$forecast" = true ] || printf 'no merge forecast: it needs git 2.38 or later\n'
printf '\nOnly commits show here: not the uncommitted work of another worktree, nor what another machine has not pushed.\n'
exit 0
