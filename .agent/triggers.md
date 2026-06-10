# FleetNeuron — Natural-Language Trigger Phrases

When a human types a natural-language command in chat, map it to the workflow file below. **This file is only relevant for interactive sessions** where a human is dispatching work via prose. Remote routines and scripted skill invocations bypass these triggers entirely — they call the skills directly.

Implementing agents (frontend / backend / database / devops / qa / ai) running unattended via the autopilot routines do not need this file.

## TPM Agent

| Trigger phrases | Workflow file |
|-----------------|---------------|
| "analyze the codebase" / "scan FleetNeuron" / "what's in the app" | `.agent/tpm/prompts/analyze_codebase.md` |
| "create backlog" / "generate tickets" / "create jira stories" | `.agent/tpm/system_prompt.md` then `.agent/tpm/prompts/create_backlog.md` |
| "sync docs" / "update confluence" / "update documentation" | `.agent/tpm/prompts/sync_docs.md` |
| "audit tests" / "find missing tests" / "test coverage" | `.agent/tpm/prompts/audit_tests.md` |
| "handoff to dev agents" / "add copy-paste prompts for agents" | `.agent/tpm/prompts/handoff_to_dev_agents.md` |
| "process work queue" / "start next task" / "pick up FN work" | `.agent/docs/process_work_queue.md` |
| "process frontend / backend / database / devops / qa / ai work queue" | `.agent/docs/process_work_queue.md` (matching queue folder) |

## Frontend Agent

| Trigger phrases | Workflow file |
|-----------------|---------------|
| "analyze UI" / "analyze the frontend" / "UI code review" (read-only) | `.agent/frontend/system_prompt.md` then `.agent/frontend/prompts/analyze_frontend_code.md` |
| "implement UI task" / "frontend agent" / "FleetNeuron frontend" / "polish the UI" | `.agent/frontend/system_prompt.md` then `.agent/frontend/prompts/implement_frontend_task.md` |

## Backend Agent

| Trigger phrases | Workflow file |
|-----------------|---------------|
| "analyze backend" / "backend code review" / "scan the backend" (read-only) | `.agent/backend/system_prompt.md` then `.agent/backend/prompts/analyze_backend_code.md` |
| "implement backend task" / "backend agent" / "FleetNeuron backend" | `.agent/backend/system_prompt.md` then `.agent/backend/prompts/implement_backend_task.md` |

## Database Agent

| Trigger phrases | Workflow file |
|-----------------|---------------|
| "analyze database" / "database schema review" (read-only) | `.agent/database/system_prompt.md` then `.agent/database/prompts/analyze_database.md` |
| "implement database task" / "database agent" / "write migration" | `.agent/database/system_prompt.md` then `.agent/database/prompts/implement_database_task.md` |

## DevOps Agent

| Trigger phrases | Workflow file |
|-----------------|---------------|
| "analyze infrastructure" / "devops review" (read-only) | `.agent/devops/system_prompt.md` then `.agent/devops/prompts/analyze_infrastructure.md` |
| "implement devops task" / "devops agent" / "update docker" / "update render" | `.agent/devops/system_prompt.md` then `.agent/devops/prompts/implement_devops_task.md` |

## QA Agent

| Trigger phrases | Workflow file |
|-----------------|---------------|
| "implement qa task" / "qa agent" / "write tests" / "write e2e tests" | `.agent/qa/system_prompt.md` then `.agent/qa/prompts/implement_qa_task.md` |

## AI Agent

| Trigger phrases | Workflow file |
|-----------------|---------------|
| "implement ai task" / "ai agent" / "FleetNeuron AI" / "update ai service" | `.agent/ai/system_prompt.md` then `.agent/ai/prompts/implement_ai_task.md` |
