---
name: pick-next-task
description: Find the next eligible task for a given agent type from the Jira queue, optionally scoped to an epic or lane.
user_invocable: true
args: "<agent-type> [epic:FN-XXX | lane:<slug>]"
---

# /pick-next-task — Find Next Eligible Task

Find the next dependency-ready task for the specified agent type. Optionally scope the search to a specific epic or swimlane.

## Input

- **First arg (required)**: agent type — `frontend`, `backend`, `database`, `qa`. (AI-service AND infra/Docker/Render work both fall under `backend` — there are no separate `ai` or `devops` agents.)
- **Second arg (optional)**: scope filter — either:
  - `epic:FN-XXX` — only tickets under epic `FN-XXX` (resolved via the epic's `epic:*` lane label)
  - `lane:<slug>` — only tickets carrying label `epic:<slug>` (e.g., `lane:quick-add-part` → label `epic:quick-add-part`)

If no scope arg is provided, read `.agent/autopilot_scope.json` and use the agent's default scope from there. If that file is missing, malformed, or the entry is `null`, no scope filter is applied.

**Precedence:** CLI arg > config file > none.

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **Jira Project Key**: `FN`
- **Scope config file**: `.agent/autopilot_scope.json`

## Steps

### 0. Resolve Scope

Parse the args:
- `AGENT = $1`
- `SCOPE_RAW = $2` (may be empty)

If `SCOPE_RAW` is empty, look it up:
```
SCOPE_RAW=$(jq -r --arg a "$AGENT" '.[$a] // empty' .agent/autopilot_scope.json 2>/dev/null)
```
If the file is missing or the entry is `null`, leave `SCOPE_RAW` empty (no scope filter).

If `SCOPE_RAW` is non-empty, parse it:
- `epic:FN-XXX` → set `SCOPE_TYPE=epic`, `SCOPE_VAL=FN-XXX`
  - Resolve the epic's lane label: `getJiraIssue` for `FN-XXX`, find the first label matching `^epic:.*`. If none, STOP with: `Epic FN-XXX has no epic:* lane label. Add one per intake's lane registry, then retry.`
  - Set `LANE_LABEL=<the epic:* label found>`
- `lane:<slug>` → set `SCOPE_TYPE=lane`, `SCOPE_VAL=<slug>`, `LANE_LABEL=epic:<slug>`
- Anything else (malformed) → STOP with: `Unrecognized scope: <SCOPE_RAW>. Use 'epic:FN-XXX' or 'lane:<slug>'.`

### 1. Query Jira Queue

Search for eligible tasks (both Stories AND Subtasks) using `searchJiraIssuesUsingJql`. The base query is:
```
project = FN AND status = "Selected for Development" AND labels = "agent:$AGENT"
```

If a scope was resolved, AND in the lane label:
```
project = FN AND status = "Selected for Development" AND labels = "agent:$AGENT" AND labels = "$LANE_LABEL"
```

Always end with `ORDER BY priority DESC, created ASC`.

This returns both Stories and Subtasks since subtasks now carry agent labels (and inherit `epic:*` lane labels from intake's propagation rule).

### 2. Check Dependencies
For each candidate task (in priority order):
- Get the issue's links using `getJiraIssue` (check `issuelinks` field)
- For each "is blocked by" link, verify the blocking issue is in "Done" status
- Skip tasks with unresolved dependencies

### 3. Prioritize Subtasks with Momentum
When multiple candidates are eligible, prefer:
1. **Subtasks whose sibling subtasks are already In Progress or Done** — keep momentum on the same story
2. **Higher priority tasks**
3. **Older tasks** (created first)

### 4. Serial-execution check (same-agent in-progress guard)

Don't start a second task for an agent that already has one in flight.

For the requested agent type `$AGENT`:
```
in_progress_count = count of FN issues where:
  status = "In Progress" AND labels = "agent:$AGENT"
```

The in-progress check is **NOT** scoped — it applies even when a scope filter is set, because two parallel tasks for the same agent still cause file conflicts regardless of which epic they belong to.

If `in_progress_count >= 1`, return NO ELIGIBLE TASKS with reason:
```
FN-XXX already In Progress for agent:$AGENT. Wait for it to reach Done or Code Review before picking the next task.
```

This trades fine-grained conflict prediction for a simple "one task per agent at a time" rule. In practice the autopilot routines already enforce this (one tick at a time, 2h apart), so this check mostly catches human-initiated work overlapping with the queue.

### 5. Return Result

**If eligible task found:**
```
NEXT TASK: FN-XXX
Type: Story / Subtask
Parent: FN-YYY (if subtask)
Summary: <summary>
Agent: $AGENT
Scope: <none | epic:FN-XXX | lane:<slug>>   ← shows the scope that was actually applied
Priority: <priority>
Dependencies: All resolved
Blockers: None

Ready to implement. Run: /implement-ticket FN-XXX
```

**If NO eligible task:**
```
NO ELIGIBLE TASKS for agent: $AGENT
Scope applied: <none | epic:FN-XXX | lane:<slug>>

Reason: <one of>
- No tasks in "Selected for Development" matching agent + scope
- All matching tasks have unresolved dependencies
- Another task is already In Progress for this agent

Blocked by:
- FN-YYY (dependency for FN-XXX, currently in <status>)

Action: Move more tickets to "Selected for Development" matching the scope, widen the scope, or resolve blockers.
```

## Rules
- NEVER pick a task that has unresolved dependencies
- NEVER pick a task not in "Selected for Development" (status filter is always applied)
- NEVER fabricate or guess tasks — only use Jira query results
- Scope filter is AND with status — both must match
- CLI arg scope overrides config-file scope; config-file scope is the default when no arg is given
- If nothing is available, STOP and report clearly (always echo the scope that was applied so the user knows why)
- Subtasks are first-class pickable items — treat them the same as stories
