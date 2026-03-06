## FleetNeuron AI Assistant – Use Cases & Success Metrics

### 1. Primary Objectives

- **Reduce friction for key workflows** by guiding users step-by-step (especially new or infrequent users).
- **Shorten time-to-completion** for common tasks like creating and managing work orders.
- **Increase feature adoption** by explaining how and when to use advanced capabilities (parts catalog, barcode scanning, integrations, reporting).
- **Deflect support tickets** by answering \"how do I…\" and basic troubleshooting questions inline in the app.

### 2. Initial Supported Workflows (v1)

#### 2.1 Work Orders

- **Create a work order**
  - Example questions:
    - \"How do I create a work order for this vehicle?\"
    - \"What fields are required for a work order?\"
  - Assistant behavior:
    - Explain the steps in the UI (navigation + required fields).
    - Propose a **work order draft** (title, description, asset, priority, due date, tasks) based on the user's question and current context (e.g. selected vehicle).
    - Let the user open a prefilled work order form and review/submit.

- **Understand work order status and fields**
  - Example questions:
    - \"What does 'Waiting on Parts' mean?\"
    - \"Why is this work order still open?\"
  - Assistant behavior:
    - Explain statuses and key fields.
    - Suggest likely next steps (e.g. add labor, receive parts, close work order).

- **Troubleshoot work order issues**
  - Example questions:
    - \"Why can't I close this work order?\"
    - \"Why is this work order not showing up on my dashboard?\"
  - Assistant behavior:
    - Ask simple clarifying questions if needed.
    - Use available context (role, work order data) to suggest likely missing steps or permissions.

#### 2.2 Parts Catalog & Inventory

- **Find and understand parts**
  - Example questions:
    - \"How do I find brake pads for this truck?\"
    - \"What does this parts screen show?\"
  - Assistant behavior:
    - Explain filters, categories, and key data fields (SKU, on-hand, reserved, available).
    - Suggest filters or navigation (e.g. open parts catalog with pre-applied filters).

- **Barcode scanning & phone bridge assistance**
  - Example questions:
    - \"How do I use my phone to scan barcodes?\"
    - \"What happens when I upload a barcode image?\"
  - Assistant behavior:
    - Explain when to use phone bridge vs desktop upload vs hardware scanner.
    - Reference the relevant flows defined in `API-BARCODE-SCAN-PHONE-BRIDGE.md` in user-friendly language.

#### 2.3 Integrations & System Setup

- **Explain integration status and configuration**
  - Example questions:
    - \"Why is my integration not syncing?\"
    - \"What is required to set up this integration?\"
  - Assistant behavior:
    - Explain common integration states, required fields, and typical troubleshooting steps.
    - Suggest which page/section to open to review configuration.

#### 2.4 General Product Help

- **Feature discovery & explanation**
  - Example questions:
    - \"What does the Maintenance module do?\"
    - \"How do I onboard new drivers?\"
  - Assistant behavior:
    - Provide concise explanations of modules and link them to business value.
    - Offer step-by-step instructions or links to more detailed documentation where available.

### 3. Guardrails & Non-Goals (v1)

- **Read-only and guided actions only**:
  - The assistant **must not** directly create, update, or delete data.
  - All actions are returned as **suggested drafts** or **navigation hints** that the user explicitly triggers.
- **No legal/compliance advice beyond documented policies**:
  - Answers are limited to your documented policies/procedures; the assistant should not invent compliance guidance.
- **Respect roles and permissions**:
  - Never expose data a user is not allowed to see.
  - Tailor guidance and suggested actions to the user's role (e.g. mechanic, manager, admin).

### 4. Success Metrics (Phase 1)

- **Task completion metrics**
  - Reduction in **time to create a work order** (from opening the page to saving) for users who engage with the assistant vs those who do not.
  - Increase in **successful first-attempt completion rate** for key flows (work order creation, parts lookup, driver onboarding) for assisted sessions.

- **Engagement metrics**
  - Number of **AI conversations per active user** per week/month.
  - Percentage of **active users who use the assistant** at least once in a given period.
  - Distribution of top question categories (work orders, inventory, integrations, general help).

- **Support & deflection metrics**
  - Reduction in **\"how-to\" support tickets** that correspond to supported workflows.
  - Qualitative feedback from support/success teams that the assistant is answering common questions effectively.

- **Quality metrics**
  - Thumbs-up / thumbs-down ratings on assistant responses where collected.
  - Percentage of suggested work order drafts that users accept with minimal edits (e.g. >70% fields unchanged).

### 5. Scope for First Release vs Future

- **Included in first release**
  - Work order help (create, understand status, common issues).
  - Parts catalog and basic inventory help.
  - High-level guidance on barcode scanning and phone bridge.
  - General navigation and feature explanation.

- **Planned for later iterations**
  - Deeper diagnostics powered by logs and monitoring (e.g. \"what failed in the last sync?\").
  - Richer integration-specific troubleshooting beyond basic config checks.
  - More granular, role-specific playbooks for operations teams.

