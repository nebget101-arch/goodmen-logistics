---
name: pick-next-task
description: Find the next eligible task for a given agent type from the Jira queue.
user_invocable: true
args: "<agent-type>"
---

# /pick-next-task — Find Next Eligible Task

Find the next dependency-ready task for the specified agent type.

## Input
The argument is the agent type: `frontend`, `backend`, `database`, `devops`, `qa`. (AI-service work falls under `backend` — there is no separate `ai` agent.)

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **Jira Project Key**: `FN`

## Steps

### 1. Query Jira Queue
Search for eligible tasks (both Stories AND Subtasks) using `searchJiraIssuesUsingJql`:
```
project = FN AND status = "Selected for Development" AND labels = "agent:$ARGS" ORDER BY priority DESC, created ASC
```

This returns both Stories and Subtasks since subtasks now carry agent labels.

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

Files Touched declarations have been dropped — they drifted in practice and added ceremony without preventing real conflicts. The replacement is a coarse-grained guard: **don't start a second task for an agent that already has one in flight**.

For the requested agent type `$ARGS`:

```
in_progress_count = count of FN issues where:
  status = "In Progress" AND labels = "agent:$ARGS"
```

If `in_progress_count >= 1`, return NO ELIGIBLE TASKS with reason:
```
FN-XXX already In Progress for agent:$ARGS. Wait for it to reach Done or Code Review before picking the next task.
```

This trades fine-grained conflict prediction for a simple "one task per agent at a time" rule. In practice the autopilot routines already enforce this (one tick at a time, 2h apart), so this check mostly catches human-initiated work overlapping with the queue.

### 5. Return Result

**If eligible task found:**
```
NEXT TASK: FN-XXX
Type: Story / Subtask
Parent: FN-YYY (if subtask)
Summary: <summary>
Agent: $ARGS
Priority: <priority>
Dependencies: All resolved
Blockers: None

Ready to implement. Run: /implement-ticket FN-XXX
```

**If NO eligible task:**
```
NO ELIGIBLE TASKS for agent: $ARGS

Reason: <one of>
- No tasks in "Selected for Development" for this agent
- All tasks have unresolved dependencies
- Conflict with in-progress work

Blocked by:
- FN-YYY (dependency for FN-XXX, currently in <status>)

Action: Ask TPM to review queue or resolve blockers.
```

## Rules
- NEVER pick a task that has unresolved dependencies
- NEVER pick a task not in "Selected for Development"
- NEVER fabricate or guess tasks — only use Jira query results
- If nothing is available, STOP and report clearly
- Subtasks are first-class pickable items — treat them the same as stories
