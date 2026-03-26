---
name: work-next
description: Pick the next eligible task for an agent and immediately implement it. Combines pick-next-task + implement-ticket.
user_invocable: true
args: "<agent-type>"
---

# /work-next — Pick and Implement Next Task

Combines `/pick-next-task` and `/implement-ticket` into a single workflow.

## Input
The argument is the agent type: `frontend`, `backend`, `ai`, `ios`, `qa`.

## Steps

### 1. Find Next Eligible Task
Execute the same logic as `/pick-next-task $ARGS`:
- Query Jira for Stories and Subtasks in "Selected for Development" with label `agent:$ARGS`
- Check all dependencies are resolved (blocking issues in "Done")
- Prefer subtasks with sibling momentum (other subtasks already in progress/done)
- Check for file/module conflicts with in-progress work
- Select the highest priority, dependency-ready task

### 2. If No Task Found → STOP
```
NO ELIGIBLE TASKS for agent: $ARGS

Blocked by:
- <list blockers>

Action: Ask TPM to review queue.
```
Do NOT proceed. Do NOT guess. Do NOT pick random work.

### 3. If Task Found → Implement
Execute the full `/implement-ticket FN-XXX` workflow:

**If Subtask:**
1. Read Jira subtask and parent story doc
2. Create branch: `$ARGS/FN-XXX/<slug>` (subtask key)
3. Transition subtask to "In Progress" (+ epic auto-transition if first)
4. Implement scoped to subtask acceptance criteria
5. Write/update tests
6. Update parent story doc with subtask completion
7. Add Jira comment with branch name
8. Commit and push
9. Transition subtask to "Done"
10. Check sibling subtask status

**If Story (no subtasks):**
1. Read Jira issue and story doc
2. Create branch: `$ARGS/FN-XXX/<slug>`
3. Transition to "In Progress" (+ epic auto-transition if first)
4. Implement scoped to acceptance criteria
5. Write/update tests
6. Update story doc (implementation, files, decisions)
7. Document deployment handoff
8. Commit changes

### 4. Output

**If Subtask completed:**
```
COMPLETED SUBTASK: FN-XXX
Parent Story: FN-YYY
Branch: $ARGS/FN-XXX/<slug>
Files changed: <count>

Sibling subtasks:
- FN-AAA: Done ✓
- FN-BBB: Done ✓
- FN-CCC: Selected for Dev (remaining)

Next step: /work-next $ARGS (to pick next subtask)
— OR —
All subtasks done → /create-pr FN-YYY (to merge and create story PR)
```

**If Story completed (no subtasks):**
```
COMPLETED: FN-XXX
Branch: $ARGS/FN-XXX/<slug>
Files changed: <count>
Deployment impact: <summary>

Next step: /create-pr FN-XXX
```

## Rules
- STOP if no eligible task — never improvise
- One task at a time
- Follow all implement-ticket rules
- Subtasks are first-class — they get picked just like stories
