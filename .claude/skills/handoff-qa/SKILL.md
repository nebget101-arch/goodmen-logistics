---
name: handoff-qa
description: QA validates acceptance criteria with evidence, creates bugs if needed, and updates story doc.
user_invocable: true
args: "<jira-key>"
---

# /handoff-qa — QA Validation

Validate the implemented ticket against its acceptance criteria.

## Input
The argument is the Jira key (e.g., `FN-42`). Can be a Story or a QA Subtask.

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **Transition IDs**: In Testing=`51`, Code Review=`61`, Done=`41`, In Progress=`31`

## Steps

### 1. Gather Context
- Fetch the Jira issue with `getJiraIssue` for `$ARGS` (cloudId: `aff43a9d-6456-476c-9aa5-1b3da163f242`)
- Determine if this is a Story or Subtask
- Read the story doc: `docs/stories/$ARGS.md` (or parent story doc if subtask)
- Find the PR: `gh pr list --search "$ARGS"` (for stories) or check parent story PR
- Review the PR diff and test results

### 2. Validate Each Acceptance Criterion
For EACH AC item from the Jira ticket:
- Describe how you validated it
- State PASS or FAIL
- Provide evidence (code references, test output, logic verification)

### 3. Capture Evidence Screenshots
When visual validation is needed:
- Use `preview_screenshot` to capture the relevant UI state
- Save screenshots to `docs/stories/evidence/FN-XXX/` (create directory if needed)
- Name files descriptively: `add-driver-datepicker-before.png`, `loads-reference.png`, etc.
- Commit evidence files to the repo
- Add a Jira comment linking to the evidence: "QA evidence committed to `docs/stories/evidence/FN-XXX/`"

For non-visual validation (API, logic, data):
- Capture test output or API responses as text in the story doc

### 4. Check for Regressions
- Review files changed and their dependencies
- Check if shared modules were modified
- Verify test coverage for affected areas

### 5. Record QA Findings
Update the story doc (or parent story doc) under **QA Findings**:
```markdown
## QA Findings
**QA Date**: YYYY-MM-DD
**Result**: PASS / FAIL

### Acceptance Criteria Validation
| AC Item | Result | Evidence |
|---------|--------|----------|
| AC 1    | PASS   | Screenshot: docs/stories/evidence/FN-XXX/ac1.png |
| AC 2    | PASS   | Verified in code — file:line |
| AC 3    | FAIL   | Expected X but found Y |

### Regression Check
- [x] No shared module impact
- [x] Tests cover changes

### Evidence
- Screenshots: `docs/stories/evidence/FN-XXX/`
- Test output: [inline or linked]

### Bugs Created
- None / FN-XXX: [bug description]
```

### 6. Handle QA Subtask (if applicable)
If this is a QA subtask (`agent:qa`):

**If automation tests are required** (specified in subtask description):
- Create branch: `qa/$ARGS/<slug>`
- Write test files (Cypress, unit specs, etc.)
- Commit and push
- Transition subtask to "Done" (transition ID `41`)

**If manual testing only:**
- No branch needed
- Capture evidence screenshots and update story doc
- Transition subtask to "Done" (transition ID `41`)

### 7. Handle Results

**If ALL AC items PASS:**
- Transition Jira to "Done" using `transitionJiraIssue` (transition ID `41`)
- Update `docs/delivery-log.md` with completion
- **Epic auto-close check**: Query all stories under the parent epic. If ALL are Done, transition the epic to "Done" automatically.
- Print: "QA PASSED — $ARGS is Done"

**If ANY AC item FAILS:**
- Create a Bug in Jira with `createJiraIssue`:
  - Type: Bug
  - Summary: `[QA] $ARGS: <failure description>`
  - Description: reproduction steps, expected vs actual, evidence links
  - Link to parent story using `createIssueLink`
- Transition original story back to "In Progress" (transition ID `31`)
- Print: "QA FAILED — Bug FN-XXX created, $ARGS back to In Progress"

### 8. Epic Completion Check
After marking a story as Done:
- Find the parent epic (from the story's epic link)
- Query: `project = FN AND issuetype = Story AND "Epic Link" = FN-EPIC AND status != Done`
- If **zero results** (all stories Done): transition the epic to "Done"
- Print: "Epic FN-EPIC auto-closed — all stories complete"

### 9. Update Delivery Log
Add entry to `docs/delivery-log.md`:
```
| $ARGS | QA PASS/FAIL | YYYY-MM-DD | [evidence location] |
```
