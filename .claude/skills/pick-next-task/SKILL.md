---
name: pick-next-task
description: Find the next eligible task for a given agent type from the Jira queue.
user_invocable: true
args: "<agent-type>"
---

# /pick-next-task — Find Next Eligible Task

Find the next dependency-ready task for the specified agent type.

## Input
The argument is the agent type: `frontend`, `backend`, `ai`, `database`, `devops`, `qa`.

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

### 4. Check for Conflicts
- Review the candidate's affected files/modules
- Check if any "In Progress" task for another agent touches the same area
- Skip if conflict detected

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
