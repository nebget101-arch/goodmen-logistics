---
name: intake
description: TPM decomposes requirements into Jira Epics/Stories/Subtasks with dependencies, assigns agents, and queues ready work.
user_invocable: true
---

# /intake — TPM Requirement Decomposition

You are the TPM. Decompose the given requirement into actionable Jira work items.

## Constants
- **Jira Cloud ID**: `aff43a9d-6456-476c-9aa5-1b3da163f242`
- **Jira Project Key**: `FN`
- **Transition IDs**: Selected for Development=`21`, In Progress=`31`, Done=`41`
- **Agent labels**: `agent:frontend`, `agent:backend`, `agent:ai`, `agent:database`, `agent:devops`, `agent:qa`

## Steps

### 1. Analyze the Requirement
- Read any provided requirements, documents, or user descriptions
- Explore the relevant codebase areas to understand current state
- Identify affected services and domains
- **Decide** the appropriate breakdown level — not every requirement needs an Epic. Use your judgment:
  - **Epic + Stories + Subtasks**: Large features spanning multiple agents/domains
  - **Story + Subtasks**: Medium features within one domain but with distinct sub-units
  - **Story only**: Small, self-contained work that one agent can complete in one pass
  - **Bug**: Defect found during analysis

### 2. Create Jira Breakdown
For each work item, create a Jira issue in project **FN** with:
- **Epic**: Top-level feature/initiative (no agent label — epics are containers)
- **Story**: User-facing deliverable (assign agent type via label: `agent:frontend`, `agent:backend`, `agent:ai`, `agent:database`, `agent:devops`)
- **Subtask**: Technical sub-unit under a story. **Each subtask MUST have an agent label** so it can be independently picked:
  - Implementation subtasks: `agent:frontend`, `agent:backend`, `agent:ai`, `agent:database`, `agent:devops`
  - QA subtasks: `agent:qa` — for validation/testing work
- **Bug**: Defect found during analysis

Use the Jira MCP tools:
- `createJiraIssue` for each item (use `parent` field to link subtasks to stories, stories to epics)
- `createIssueLink` for cross-story dependencies (use "Blocks" link type)

### 3. Subtask Guidelines
When breaking a story into subtasks:
- Each subtask should be a self-contained piece of work that one agent can complete
- Always include a **QA subtask** for validation (label: `agent:qa`)
  - QA subtasks should describe what to validate and what evidence to capture
  - If automation tests are needed, specify that in the description
- Subtask branch naming: `<agent>/FN-XXX/<slug>` where FN-XXX is the subtask key
- Story branch (merge target): `<agent>/FN-STORY/<slug>` where FN-STORY is the parent story key

### 4. Define Dependencies
- Identify which stories/subtasks must complete before others can start
- Create "Blocks" links between dependent issues
- Within a story, sequence subtasks if they have internal dependencies
- Document the dependency chain in the story doc

### 5. Create Story Doc Stubs
For each Story, create `docs/stories/FN-XXX.md` using this template:

```markdown
# FN-XXX: [Story Title]

## Requirement
[What needs to be built and why]

## Acceptance Criteria
- [ ] AC item from Jira

## Dependencies
- FN-YYY (must complete first)

## Agent
[frontend | backend | ai | database | devops]

## Subtasks
| Key | Summary | Agent | Branch | Status |
|-----|---------|-------|--------|--------|
| FN-AAA | [subtask description] | frontend | `frontend/FN-AAA/<slug>` | Pending |
| FN-BBB | [subtask description] | backend | `backend/FN-BBB/<slug>` | Pending |
| FN-CCC | QA validation | qa | _manual_ | Pending |

## Implementation Summary
_To be filled by implementing agent_

## Files Changed
_To be filled by implementing agent_

## Key Decisions
_To be filled by implementing agent_

## Deployment Handoff
_To be filled by implementing agent_

## Review Findings
_To be filled by Code Reviewer_

## QA Findings
_To be filled by QA_

## Open Items
- None
```

### 6. Queue Ready Work
- For stories/subtasks with NO unresolved dependencies: transition to "Selected for Development" (transition ID `21`)
- For stories/subtasks WITH dependencies: leave in backlog until dependencies are Done
- **Subtask queuing**: If a story has subtasks, queue the dependency-free subtasks (not the story itself). The story moves through the lifecycle via its subtasks.
- Update `docs/delivery-log.md` with the new work items

### 7. Epic Lifecycle
- Epics start in Backlog when created
- When the **first story** under an epic transitions to In Progress, auto-transition the epic to In Progress
- Epic stays In Progress until ALL stories are Done, then auto-transition to Done

### 8. Output Summary
Print a summary table:
```
| Jira Key | Type    | Summary               | Agent    | Parent  | Dependencies | Status           |
|----------|---------|-----------------------|----------|---------|-------------|------------------|
| FN-100   | Epic    | Feature name          | —        | —       | —           | Backlog          |
| FN-101   | Story   | User-facing work      | frontend | FN-100  | None        | Backlog          |
| FN-102   | Subtask | Implement component   | frontend | FN-101  | None        | Selected for Dev |
| FN-103   | Subtask | API endpoint          | backend  | FN-101  | None        | Selected for Dev |
| FN-104   | Subtask | QA validation         | qa       | FN-101  | FN-102,103  | Blocked          |
```
