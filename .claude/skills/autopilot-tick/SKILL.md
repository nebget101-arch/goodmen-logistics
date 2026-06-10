---
name: autopilot-tick
description: Unattended driver — pick next eligible task for one agent type, implement it, open the PR, self-review, and auto-merge only if the diff matches the strict safe-change allowlist. Supports optional epic/lane scope.
user_invocable: true
args: "<agent-type> [epic:FN-XXX | lane:<slug>]"
---

# /autopilot-tick — Unattended Tick (Pick → Implement → PR → Review → Maybe-Merge)

Designed for scheduled remote runs. Performs **at most one task per tick** and always exits cleanly. If anything is ambiguous or risky, the tick stops and leaves the work for a human.

## Input
- **First arg (required)**: agent type — `frontend`, `backend`, `database`, `devops`, `qa`. (AI-service work falls under `backend` — there is no separate `ai` agent. The `backend/microservices/ai-service/` path stays on the blocklist so AI-service PRs never auto-merge.)
- **Second arg (optional)**: scope filter — `epic:FN-XXX` or `lane:<slug>`. If omitted, the agent's default scope is read from `.agent/autopilot_scope.json`. See `/pick-next-task` §0 for full scope semantics.

The full `$ARGS` (including the scope token if present) is passed through verbatim to `/work-next` in step 2.

**How to set scope per routine:** edit the routine's prompt in the web UI from `/autopilot-tick backend` to `/autopilot-tick backend epic:FN-1090`. Or leave the prompt unchanged and edit `.agent/autopilot_scope.json` in the repo to set per-agent defaults (commit + push to dev).

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **Jira Project Key**: `FN`
- **PR base branch**: `dev`
- **Auto-merge label format**: `autopilot:<agent-type>` (added to the PR before merge — used for rate-limiting on the next tick)
- **Rate limit**: at most **1 autopilot-merged PR per agent per 24h**

## Workflow

### 1. Repo sync
```
git fetch origin
git checkout dev
git pull --ff-only origin dev
```
If the pull is not a fast-forward, STOP and print `autopilot: dev pull not ff — aborting tick`.

### 2. Pick + implement (delegates to /work-next $ARGS)
Execute the full `/work-next $ARGS` flow (see `.claude/skills/work-next/SKILL.md`).

Interpret the result:
- **No eligible task** → print `autopilot: idle — no eligible tasks for $ARGS` and STOP.
- **Subtask completed and siblings remain** → print `autopilot: subtask FN-XXX done; siblings remain — next tick will resume` and STOP.
- **Subtask completed and ALL siblings now Done** → set `STORY_KEY = parent-story-key`. Continue to step 3.
- **Story without subtasks completed** → set `STORY_KEY = implemented-ticket-key`. Continue to step 3.
- **Anything else (error, conflict, partial state)** → STOP. Print the actual error and `autopilot: stopping for human review`.

### 3. Open the PR (delegates to /create-pr $STORY_KEY)
Execute the full `/create-pr $STORY_KEY` flow (see `.claude/skills/create-pr/SKILL.md`).

If `/create-pr` STOPs at any guard (subtask passed instead of story, duplicate-agent, integration branch missing, merge conflicts on dev rebase, etc.), STOP and print the guard reason. Do not retry.

Capture `PR_NUMBER` and `PR_URL` from the gh output.

### 4. Self-review (delegates to /review-ticket $STORY_KEY)
Execute the full `/review-ticket $STORY_KEY` flow (see `.claude/skills/review-ticket/SKILL.md`).

Capture `REVIEW_VERDICT` from the recommendation: `APPROVE`, `REQUEST CHANGES`, or `BLOCK`.

### 5. Auto-merge gate

Auto-merge happens ONLY if every gate below passes. Any failure → leave PR for human merge.

#### Gate 5.1 — Verdict
`REVIEW_VERDICT` must be `APPROVE`.

#### Gate 5.2 — Rate limit (1 autopilot merge per agent per 24h)
```
SINCE=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)
RECENT=$(gh pr list --state merged --label "autopilot:$ARGS" \
  --json number,mergedAt \
  --jq "map(select(.mergedAt > \"$SINCE\")) | length")
```
If `RECENT > 0`, gate fails.

#### Gate 5.3 — Diff inspection
Fetch the file change list and per-file status:
```
gh pr view $PR_NUMBER --json files --jq '.files[] | "\(.path)\t\(.additions)\t\(.deletions)"' > /tmp/pr_files.tsv
gh pr diff $PR_NUMBER --name-only > /tmp/pr_paths.txt
```

Build two sets:
- `CHANGED` — every path in the PR
- `ADDED_ONLY` — files where `deletions == 0` (treated as additions, conservative proxy for "new file")

#### Gate 5.4 — Hard blocklist (NEVER auto-merge if any of these match)
A PR is hard-blocked from auto-merge if **any path** in `CHANGED` matches **any** of:
- `migrations/` (any depth — includes Knex migrations)
- `^package(-lock)?\.json$` at any depth
- `yarn\.lock$`, `pnpm-lock\.yaml$`
- `Dockerfile`, `docker-compose`, `^render\.yaml$`, `\.env`
- `^\.claude/`, `^\.agent/`, `^\.github/`
- `backend/microservices/[^/]+/routes/`
- `backend/packages/goodmen-shared/services/`
- `backend/microservices/ai-service/`
- Case-insensitive substring `auth`, `billing`, `payment`, `stripe`, `jwt`, `secret`, `credential`
- Anything matching `backend/microservices/integrations-service/`

If the blocklist matches, gate fails.

#### Gate 5.5 — Allowlist category match
The PR must match **exactly one** of these categories. Every file in `CHANGED` must satisfy the category rule.

- **DOCS_ONLY**: every path matches one of:
  - `^docs/.*\.md$`
  - `^[A-Z][A-Z0-9_]*\.md$` (top-level uppercase markdown like README/CHANGELOG)
- **SCSS_ONLY**: every path ends in `\.scss$` AND zero paths match `\.(ts|tsx|html|js|jsx|json)$`
- **TEST_ADDITIONS_ONLY**: every path is in `ADDED_ONLY` AND matches at least one of:
  - `\.test\.(js|ts|tsx)$`
  - `\.spec\.(js|ts|tsx)$`
  - `\.cy\.(js|ts|tsx)$`
  - `\.feature$`
  - `/__tests__/`
  - `^backend/.*/test/.*\.js$`

If no category matches cleanly, gate fails.

### 6. Merge or hand off

**All gates passed**:
```
gh pr edit $PR_NUMBER --add-label "autopilot:$ARGS"
gh pr edit $PR_NUMBER --add-label "autopilot-category:<DOCS_ONLY|SCSS_ONLY|TEST_ADDITIONS_ONLY>"
gh pr merge $PR_NUMBER --squash --delete-branch
```
Then:
- Transition the Jira story to **Done** (transition ID `41`)
- Add a Jira comment: `Autopilot auto-merged <PR_URL> into dev. Category: <CATEGORY>. Self-review: APPROVE.`
- Print `autopilot: AUTO-MERGED <STORY_KEY> (<CATEGORY>)`

**Any gate failed**:
- Add a PR comment listing each gate result (Pass/Fail) and the reason for any failure. This produces an audit trail visible to the user and the next tick.
- Do NOT merge.
- Do NOT transition Jira (the `/create-pr` step already moved it to Code Review).
- Print `autopilot: <STORY_KEY> awaits human merge — gate failed: <gate-name>`

### 7. Append to the run log (ALWAYS, even on idle ticks)

Every tick — regardless of outcome — must append one line to a consolidated log on a dedicated `autopilot-log` branch. This is the user's single audit point for unattended activity. Do this AFTER the main work above completes (or STOPs).

**Determine the outcome variables** based on which exit path the tick took:

| OUTCOME | When | TICKET | NOTES |
|---|---|---|---|
| `IDLE` | Step 2 returned "No eligible task" | `—` | `No eligible tasks for <agent>` |
| `IMPLEMENTED_SUBTASK` | Step 2 implemented a subtask; siblings remain | `FN-SUBTASK` | `Subtask done; siblings remain` |
| `PR_OPENED` | Step 3 succeeded but gates failed (PR awaits human) | `FN-STORY` | `PR #<num>: <gate-name> failed` |
| `AUTO_MERGED` | Step 6 merged the PR | `FN-STORY` | `PR #<num> merged; category <CAT>` |
| `STOPPED` | Any flow STOPped at a guard | `FN-XXX or —` | One-line reason |
| `ERROR` | Anything unexpected | `—` | One-line error summary |

**Append the line:**
```
LOG_BRANCH=autopilot-log
LOG_FILE=docs/autopilot-log.md
TS=$(date -u '+%Y-%m-%d %H:%MZ')
LOG_LINE="| $TS | $ARGS | $OUTCOME | $TICKET | $NOTES |"

git fetch origin "$LOG_BRANCH" 2>/dev/null || true
if git rev-parse --verify "origin/$LOG_BRANCH" >/dev/null 2>&1; then
  git worktree add /tmp/autopilot-log-wt -B "$LOG_BRANCH" "origin/$LOG_BRANCH"
else
  git worktree add /tmp/autopilot-log-wt -b "$LOG_BRANCH" origin/dev
fi

cd /tmp/autopilot-log-wt
mkdir -p docs
if [ ! -f "$LOG_FILE" ]; then
  cat > "$LOG_FILE" <<'HDR'
# Autopilot Run Log

One row per tick across all agents. Newest entries at the bottom. This branch (`autopilot-log`) is **never merged into dev** — it exists solely as an append-only audit log.

| Timestamp (UTC) | Agent | Outcome | Ticket | Notes |
|---|---|---|---|---|
HDR
fi

echo "$LOG_LINE" >> "$LOG_FILE"
git add "$LOG_FILE"
git commit -m "autopilot-log: $ARGS $OUTCOME"
git push origin "$LOG_BRANCH"

cd - >/dev/null
git worktree remove /tmp/autopilot-log-wt
```

If the log append fails (network, push race), do NOT block the rest of the tick — print `autopilot: log-append failed: <reason>` and continue. The tick output in routine history is still available as a fallback.

**Viewing the log:** `https://github.com/nebget101-arch/goodmen-logistics/blob/autopilot-log/docs/autopilot-log.md`

## Iron rules
1. **One ticket per tick.** Never loop within a tick. Never start a second `/work-next` if the first finished.
2. **Always exit cleanly.** Never crash, never leave the worktree in an unknown state. If something is unexpected, print the situation and STOP.
3. **The blocklist wins over the allowlist.** If a path matches both a blocklist pattern and an allowlist category, the PR is NOT auto-merged.
4. **Self-review is not enough.** Auto-merge requires APPROVE AND a clean allowlist match AND a clean blocklist AND the 24h rate limit.
5. **No force-pushing to dev.** Ever.
6. **No `--no-verify` or `--no-gpg-sign` on commits.**
7. **If anything in the underlying flows STOPs, this skill STOPs** — but it still appends a `STOPPED` row to the run log before exiting.
8. **The run log is append-only.** Never edit, never rewrite history on the `autopilot-log` branch. Never merge it into dev.

## What this skill explicitly does NOT do
- Resolve merge conflicts on dev rebase. If `/create-pr` hits conflicts, this skill stops.
- Merge anything touching migrations, production routes, ai-service, infra, package files, or auth/billing/payment paths.
- Re-implement work or retry failures from a previous tick. Each tick is independent.
- Touch `main`. PRs always target `dev`.
