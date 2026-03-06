## AI Chat API – `/api/ai/chat`

This document defines the backend API contract between the FleetNeuron frontend and the AI assistant service exposed via the gateway.

The gateway will proxy `/api/ai/*` to an internal AI microservice (e.g. `AI_SERVICE_URL`), but the frontend only talks to `/api/ai/chat`.

---

### 1. Endpoint

- **Method**: `POST`
- **URL**: `/api/ai/chat`
- **Auth**: Required (same JWT as other authenticated app APIs)
- **Content-Type**: `application/json`

---

### 2. Request Body

```json
{
  "message": "How do I create a work order for this vehicle?",
  "conversationId": "optional-conversation-id",
  "context": {
    "route": "/work-order",
    "selectedEntityIds": {
      "workOrderId": null,
      "vehicleId": "veh_123",
      "partId": null
    },
    "user": {
      "id": "user_123",
      "role": "mechanic"
    },
    "locale": "en-US"
  },
  "clientMeta": {
    "appVersion": "web-1.0.0",
    "uiSurface": "global-chat"
  }
}
```

- **Fields**
  - **`message`** (string, required): The user’s latest message.
  - **`conversationId`** (string, optional):
    - Omit on the first message; backend generates and returns one.
    - Include on subsequent turns to keep context.
  - **`context`** (object, optional but recommended):
    - **`route`** (string): Current Angular route or path (e.g. `/work-order`, `/inventory/parts`).
    - **`selectedEntityIds`** (object):
      - `workOrderId` (string | null)
      - `vehicleId` (string | null)
      - `partId` (string | null)
    - **`user`** (object, optional):
      - `id` (string): Current user id.
      - `role` (string): Role such as `mechanic`, `manager`, `admin`, etc., if easily available on the client.
    - **`locale`** (string): e.g. `en-US`.
  - **`clientMeta`** (object, optional):
    - `appVersion` (string)
    - `uiSurface` (string): e.g. `global-chat`, `work-order-help`, `parts-help`.

---

### 3. Response Body

```json
{
  "conversationId": "conv_abc123",
  "messages": [
    {
      "id": "msg_user_1",
      "role": "user",
      "content": "How do I create a work order for this vehicle?",
      "createdAt": "2026-03-06T12:00:00.000Z"
    },
    {
      "id": "msg_ai_1",
      "role": "assistant",
      "content": "To create a work order for this vehicle, follow these steps: ...",
      "createdAt": "2026-03-06T12:00:02.000Z"
    }
  ],
  "suggestions": [
    {
      "id": "sugg_work_order_draft_1",
      "type": "workOrderDraft",
      "title": "Create work order draft",
      "description": "Draft a work order for VEH-123 based on the issue you described.",
      "payload": {
        "assetId": "veh_123",
        "title": "Brake inspection",
        "description": "Investigate braking noise reported by driver.",
        "priority": "medium",
        "dueDate": "2026-03-10",
        "tasks": [
          {
            "description": "Inspect front and rear brakes",
            "estimatedHours": 1.5
          }
        ]
      }
    },
    {
      "id": "sugg_navigation_1",
      "type": "navigation",
      "title": "Go to Work Orders",
      "description": "Open the work orders page to create this draft.",
      "payload": {
        "targetScreen": "work-order",
        "params": {
          "assetId": "veh_123"
        }
      }
    }
  ],
  "meta": {
    "model": "openai:gpt-4.1",
    "processingTimeMs": 1200
  }
}
```

- **Fields**
  - **`conversationId`** (string): Stable id for this chat; the frontend must reuse it on the next turn.
  - **`messages`** (array):
    - History window relevant to this turn, ordered oldest → newest.
    - Each message:
      - `id` (string)
      - `role` (`"user"` | `"assistant"`)
      - `content` (string; markdown allowed)
      - `createdAt` (ISO timestamp)
  - **`suggestions`** (array, optional):
    - Zero or more **guided actions** the user can trigger.
    - Each suggestion:
      - `id` (string): Unique per response.
      - `type` (string): Known types in v1:
        - `"workOrderDraft"`
        - `"navigation"`
        - `"explanation"` (for rich, structured explanations)
      - `title` (string): Short label to show on card/button.
      - `description` (string): Human-readable explanation.
      - `payload` (object): Type-specific structured data.
  - **`meta`** (object, optional):
    - `model` (string): Underlying LLM identifier.
    - `processingTimeMs` (number): Total server-side processing time.

---

### 4. Suggestion Payload Schemas (v1)

#### 4.1 `workOrderDraft`

```json
{
  "id": "sugg_work_order_draft_1",
  "type": "workOrderDraft",
  "title": "Create work order draft",
  "description": "Draft a work order for VEH-123 based on the issue you described.",
  "payload": {
    "assetId": "veh_123",
    "title": "Brake inspection",
    "description": "Investigate braking noise reported by driver.",
    "priority": "medium",
    "dueDate": "2026-03-10",
    "tasks": [
      {
        "description": "Inspect front and rear brakes",
        "estimatedHours": 1.5
      }
    ]
  }
}
```

- Frontend behavior:
  - Show a card/button using `title` and `description`.
  - When clicked:
    - Navigate to the work order creation page.
    - Prefill the form using `payload` (fields mapped to your existing work order form model).
    - Let the user review and submit; **no automatic save**.

#### 4.2 `navigation`

```json
{
  "id": "sugg_navigation_1",
  "type": "navigation",
  "title": "Go to Work Orders",
  "description": "Open the work orders page to create this draft.",
  "payload": {
    "targetScreen": "work-order",
    "params": {
      "assetId": "veh_123"
    }
  }
}
```

- Frontend behavior:
  - Show a card/button.
  - When clicked:
    - Use `targetScreen` + `params` to navigate (e.g. via Angular router) and optionally set initial filters or selected entity.

#### 4.3 `explanation`

```json
{
  "id": "sugg_explain_status_1",
  "type": "explanation",
  "title": "Why this work order is Waiting on Parts",
  "description": "Explanation of the current status and typical next steps.",
  "payload": {
    "markdown": "This work order is in **Waiting on Parts** because ...",
    "relatedLinks": [
      {
        "label": "Open Parts Catalog",
        "targetScreen": "parts",
        "params": {}
      }
    ]
  }
}
```

- Frontend behavior:
  - Render `payload.markdown` in a small expandable panel or card.
  - Optionally show buttons for any `relatedLinks`.

---

### 5. Error Responses

Errors follow the existing backend style:

```json
{
  "success": false,
  "error": "AI service unavailable",
  "code": "AI_UNAVAILABLE"
}
```

- Possible error codes:
  - `AI_UNAVAILABLE` – AI service down or not reachable.
  - `AI_TIMEOUT` – AI request exceeded server time limit.
  - `AI_BAD_REQUEST` – Input validation failed (e.g. missing `message`).
  - `AI_RATE_LIMITED` – User or org exceeded AI usage limits.

On errors, the frontend should:
- Show a non-blocking message inside the chat panel.
- Allow the user to retry or continue using the app normally.

---

### 6. Versioning & Extensibility

- New suggestion `type` values may be added over time.
- Frontend should:
  - Gracefully ignore unknown `type` values (e.g. show as generic info card, or hide).
  - Treat any extra fields in `payload` as optional.

