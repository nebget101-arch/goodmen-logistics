---
name: autopilot-tick
description: Unattended driver — pick next eligible task(s) for one agent type, implement, open PR, self-review, auto-merge safe diffs. Supports optional epic/lane scope, drain mode (multi-task), and Backlog auto-refill when queue is empty.
user_invocable: true
args: "<agent-type> [epic:FN-XXX | lane:<slug>] [drain | max-tasks=N | single-task]"
---

# /autopilot-tick — Unattended Tick (Pick → Implement → PR → Review → Maybe-Merge)

Designed for scheduled remote runs AND manual drain runs. By default performs **one task per tick** (predictable cost for cron). In drain mode, loops up to a hard cap and auto-refills the queue from Backlog when nothing eligible remains. Always exits cleanly.

## Input
- **First arg (required)**: agent type — `frontend`, `backend`, `database`, `qa`. (AI-service AND infra/Docker/Render work both fall under `backend` — there are no separate `ai` or `devops` agents. The `backend/microservices/ai-service/`, `Dockerfile`, `render.yaml`, `.env*`, `infra/` paths all stay on the blocklist so those PRs never auto-merge.)
- **Scope token (optional)**: `epic:FN-XXX` or `lane:<slug>`. If omitted, the agent's default scope is read from `.agent/autopilot_scope.json`. See `/pick-next-task` §0 for full scope semantics.
- **Mode token (optional)**: controls how many tasks the loop processes per tick.
  - `single-task` (default if no mode token) — exactly one task, then exit. Cron-safe, predictable cost.
  - `max-tasks=N` — process up to N tasks (N clamped to `[1, 10]`).
  - `drain` — alias for `max-tasks=10`. Process up to 10 tasks per tick; auto-refill the queue from Backlog if the in-scope queue empties.

Scope and mode tokens can appear in either order after the agent type. Examples:
- `backend lane:roadside-v2` — 1 task on roadside lane (default single-task).
- `backend lane:roadside-v2 drain` — drain mode on roadside lane.
- `backend drain` — drain mode, scope from `.agent/autopilot_scope.json`.
- `backend max-tasks=3 epic:FN-1090` — up to 3 tasks under FN-1090.

**How to set scope/mode per routine:** edit the routine's prompt in the web UI to include the tokens you want. Per-agent default scope can also be set in `.agent/autopilot_scope.json`.

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **Jira Project Key**: `FN`
- **PR base branch**: `dev`
- **Auto-merge label format**: `autopilot:<agent-type>` (added to the PR before merge — used for rate-limiting on the next tick)
- **Rate limit**: at most **1 autopilot-merged PR per agent per 24h**
- **HARD_CAP_TASKS** = `10` — absolute ceiling on tasks per tick, regardless of `max-tasks` arg.
- **MAX_REFILLS_PER_TICK** = `3` — at most 3 Backlog refills per tick.
- **PER_REFILL_LIMIT** = `5` — each refill transitions at most 5 dep-free Backlog tickets to Selected for Dev.

## Workflow

### 0. Parse args and initialize tick state
Parse `$ARGS` tokens (order-flexible):
- First positional token → `AGENT`.
- Token starting with `epic:` or `lane:` → scope (passed to `/work-next` later).
- Token equal to `single-task` → `MAX_TASKS = 1` (default if no mode token present).
- Token equal to `drain` → `MAX_TASKS = HARD_CAP_TASKS` (10).
- Token matching `max-tasks=N` → `MAX_TASKS = clamp(N, 1, HARD_CAP_TASKS)`.

Initialize:
- `TASKS_DONE = 0`
- `REFILLS_DONE = 0`

### 1. Repo sync (once per tick)
```
git fetch origin
git checkout dev
git pull --ff-only origin dev
```
If the pull is not a fast-forward, STOP and print `autopilot: dev pull not ff — aborting tick`.

### 2. Tick loop
Repeat steps 2.1 → 2.7 while `TASKS_DONE < MAX_TASKS`. Each iteration is one task attempt and produces one run-log row (step 7). After the loop exits (any reason), proceed to step 8 (final summary log row).

Iteration outcome routing:
- A task was implemented → `TASKS_DONE++`; continue loop.
- No eligible task → try step 2.8 (refill). If refill produces work, continue loop. Otherwise exit loop with outcome `IDLE`.
- Any underlying skill STOPped (error, conflict, guard) → exit loop with outcome `STOPPED`.

### 2.1 Pick + implement (delegates to /work-next $AGENT [scope])
Execute the full `/work-next` flow with the agent + scope tokens (NOT the mode token — drain is internal to autopilot-tick).

Interpret the result:
- **No eligible task** → go to step 2.8 (refill).
- **Subtask completed and non-QA siblings remain** → log `IMPLEMENTED_SUBTASK` for this iteration; `TASKS_DONE++`; continue tick loop.
- **Subtask completed and ALL non-QA siblings now Done** → set `STORY_KEY = parent-story-key`. Continue to step 2.2.
- **Story without subtasks completed** → set `STORY_KEY = implemented-ticket-key`. Continue to step 2.2.
- **Anything else (error, conflict, partial state)** → log `STOPPED`; exit tick loop.

### 2.2 Open the PR (delegates to /create-pr $STORY_KEY)
Execute the full `/create-pr $STORY_KEY` flow (see `.claude/skills/create-pr/SKILL.md`).

If `/create-pr` STOPs at any guard (subtask passed instead of story, duplicate-agent, integration branch missing, merge conflicts on dev rebase, etc.), log `STOPPED` for this iteration and exit the tick loop. Do not retry.

Capture `PR_NUMBER` and `PR_URL` from the gh output.

### 2.3 Self-review (delegates to /review-ticket $STORY_KEY)
Execute the full `/review-ticket $STORY_KEY` flow (see `.claude/skills/review-ticket/SKILL.md`).

Capture `REVIEW_VERDICT` from the recommendation: `APPROVE`, `REQUEST CHANGES`, or `BLOCK`.

### 2.4 Auto-merge gate

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

### 2.5 Merge or hand off

**All gates passed**:
```
gh pr edit $PR_NUMBER --add-label "autopilot:$AGENT"
gh pr edit $PR_NUMBER --add-label "autopilot-category:<DOCS_ONLY|SCSS_ONLY|TEST_ADDITIONS_ONLY>"
gh pr merge $PR_NUMBER --squash --delete-branch
```
Then:
- Transition the Jira story to **Done** (transition ID `41`)
- Add a Jira comment: `Autopilot auto-merged <PR_URL> into dev. Category: <CATEGORY>. Self-review: APPROVE.`
- Print `autopilot: AUTO-MERGED <STORY_KEY> (<CATEGORY>)`
- Iteration outcome: `AUTO_MERGED`; `TASKS_DONE++`; continue tick loop.

**Any gate failed**:
- Add a PR comment listing each gate result (Pass/Fail) and the reason for any failure. This produces an audit trail visible to the user and the next tick.
- Do NOT merge.
- Do NOT transition Jira (the `/create-pr` step already moved it to Code Review).
- Print `autopilot: <STORY_KEY> awaits human merge — gate failed: <gate-name>`
- Iteration outcome: `PR_OPENED`; `TASKS_DONE++`; continue tick loop.

### 2.6 (reserved)

### 2.7 Per-iteration run-log row
Append one row to `docs/autopilot-log.md` on the `autopilot-log` branch for this iteration's outcome. See step 7 for the row format and append mechanics. Each iteration produces exactly one row.

### 2.8 Refill from Backlog (when /work-next returned "No eligible task")

If `REFILLS_DONE >= MAX_REFILLS_PER_TICK`: exit tick loop with outcome `IDLE`. Print `autopilot: idle — max refills reached`.

Otherwise, try to move dependency-free Backlog tickets in scope into Selected for Development:

1. Resolve the lane label the same way `/pick-next-task` §0 does (CLI scope arg > `.agent/autopilot_scope.json[$AGENT]` > none).

2. Query Backlog candidates (subtasks first; standalone stories second):
   ```
   project = FN AND status = "Backlog" AND issuetype = "Sub-task"
     AND labels = "agent:$AGENT"
     AND [if scope: labels = "$LANE_LABEL"]
   ORDER BY priority DESC, created ASC
   ```
   Take the first `PER_REFILL_LIMIT` results.

3. For each candidate, filter out the unrefilable:
   - Parent story must be in `Backlog`, `Selected for Development`, or `In Progress` (skip if Done or Canceled).
   - Any "is blocked by" link must resolve to `Done` (skip otherwise).

4. For each remaining candidate, transition to **Selected for Development** (transition ID `21`). Count successes as `REFILLED`.

5. If still no candidates found, query standalone stories (issuetype = `Story` with no subtasks) under the same agent + scope filter, same blocker check, transition up to remaining `PER_REFILL_LIMIT` to Selected for Dev.

6. `REFILLS_DONE++`. Append a log row for this refill: outcome `REFILLED`, ticket `—`, notes `Refilled <count> tickets into Selected for Dev (refill #<REFILLS_DONE>)`.

7. If `REFILLED == 0`: exit tick loop with outcome `IDLE`. Print `autopilot: idle — no Backlog tickets to refill for $AGENT (scope: <scope>)`.

8. If `REFILLED > 0`: continue tick loop (next iteration calls `/work-next` again, now with new tickets in the queue).

### 7. Append to the run log (per-iteration mechanics)

Every tick iteration AND the final tick summary append rows to a consolidated log on a dedicated `autopilot-log` branch. This is the user's single audit point for unattended activity. Per-iteration rows are appended within step 2.7; the final summary row is appended in step 8.

**Outcome enum** (used by all rows in this file):

| OUTCOME | When | TICKET | NOTES |
|---|---|---|---|
| `IDLE` | Iteration: /work-next returned "No eligible task" and refill produced 0; OR final: tick exited with no work done | `—` | Idle reason |
| `IMPLEMENTED_SUBTASK` | Iteration: /work-next implemented a subtask; non-QA siblings remain | `FN-SUBTASK` | `Subtask done; siblings remain` |
| `PR_OPENED` | Iteration: PR created but auto-merge gate failed (awaits human) | `FN-STORY` | `PR #<num>: <gate-name> failed` |
| `AUTO_MERGED` | Iteration: gates passed, PR squash-merged | `FN-STORY` | `PR #<num> merged; category <CAT>` |
| `REFILLED` | Iteration: refill step moved Backlog tickets to Selected for Dev | `—` | `Refilled <count> tickets (refill #N)` |
| `STOPPED` | Iteration or final: any underlying skill STOPped at a guard | `FN-XXX or —` | One-line reason |
| `TICK_SUMMARY` | Final summary after loop exits | `—` | `tasks_done=X refills_done=Y exit=<reason> max_tasks=Z` |
| `ERROR` | Anything unexpected | `—` | One-line error summary |

**Append a single row** (the agent in the log row is always `$AGENT`, not the full `$ARGS`, so logs stay readable):
```
LOG_BRANCH=autopilot-log
LOG_FILE=docs/autopilot-log.md
TS=$(date -u '+%Y-%m-%d %H:%M:%SZ')
LOG_LINE="| $TS | $AGENT | $OUTCOME | $TICKET | $NOTES |"

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

### 8. Final tick summary row
After the tick loop exits for any reason, append one final `TICK_SUMMARY` row using the same mechanics as step 7:

- TICKET = `—`
- NOTES = `tasks_done=$TASKS_DONE refills_done=$REFILLS_DONE exit=<reason> max_tasks=$MAX_TASKS`

Where `<reason>` is one of: `max-tasks-cap`, `hard-cap`, `idle`, `stopped`, `error`.

Then print `autopilot: TICK COMPLETE — agent=$AGENT tasks=$TASKS_DONE refills=$REFILLS_DONE` and exit cleanly.

## Iron rules
1. **Bounded loop only.** Tick loop never exceeds `min(MAX_TASKS, HARD_CAP_TASKS)` iterations. No conditional that lets the loop run unbounded, ever.
2. **At most 3 refills per tick.** `REFILLS_DONE` is hard-capped; a tick cannot transition more than `MAX_REFILLS_PER_TICK * PER_REFILL_LIMIT = 15` Backlog tickets to Selected for Dev.
3. **Always exit cleanly.** Never crash, never leave a worktree in an unknown state. On unexpected error, append a `STOPPED` log row, then a `TICK_SUMMARY`, then exit.
4. **The blocklist wins over the allowlist.** If a path matches both a blocklist pattern and an allowlist category, the PR is NOT auto-merged.
5. **Self-review is not enough.** Auto-merge requires APPROVE AND a clean allowlist match AND a clean blocklist AND the 24h rate limit. Rate limit is across the whole 24h window — a multi-task tick respects it (the second auto-merge in the same tick will fail gate 5.2 because the first was just labeled).
6. **No force-pushing to dev.** Ever.
7. **No `--no-verify` or `--no-gpg-sign` on commits.**
8. **If anything in the underlying flows STOPs, the tick loop STOPs** — log `STOPPED` for that iteration, log a `TICK_SUMMARY`, exit.
9. **The run log is append-only.** Never edit, never rewrite history on the `autopilot-log` branch. Never merge it into dev.
10. **Refill is for already-decomposed work.** This skill never invokes intake decomposition — it only transitions existing Backlog tickets that already have agent labels and are dependency-free. New requirements → new stories still go through human intake.

## What this skill explicitly does NOT do
- Resolve merge conflicts on dev rebase. If `/create-pr` hits conflicts, the tick loop stops.
- Merge anything touching migrations, production routes, ai-service, infra, package files, or auth/billing/payment paths.
- Re-implement work or retry failures from a previous tick. Each tick is independent.
- Touch `main`. PRs always target `dev`.
- Invoke `/intake` to decompose new requirements. Refill only transitions existing Backlog tickets that intake already created. A truly empty queue with no Backlog candidates is reported as `IDLE`; the user runs intake manually for new work.
- Exceed `HARD_CAP_TASKS` (10) tasks per tick or `MAX_REFILLS_PER_TICK` (3) refills per tick, regardless of arguments.
