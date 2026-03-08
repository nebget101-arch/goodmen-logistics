# API Contract Template

**Feature:** [Feature Name]  
**API Owner:** Backend AI  
**Consumers:** Frontend AI, iOS AI, Android AI  
**Version:** 1.0  
**Last Updated:** [Date]  
**Status:** 🔵 Draft / 🟡 Review / 🟢 Approved / 🔴 Deprecated

---

## Overview

**Purpose:** [Brief description of what this API does and why it exists]

**Use Cases:**
- Use case 1: [Description]
- Use case 2: [Description]

---

## Endpoints

### 1. List [Resource]

**Method & Path:** `GET /api/[resource]`

**Description:** Retrieves a paginated list of [resource] with optional filtering and sorting.

**Authentication:** Required (JWT)

**Authorization:** Requires `[resource].view` permission

**Query Parameters:**

| Parameter | Type | Required | Default | Description | Example |
|-----------|------|----------|---------|-------------|---------|
| `page` | integer | No | 1 | Page number (1-indexed) | `?page=2` |
| `limit` | integer | No | 20 | Items per page (max 100) | `?limit=50` |
| `sort` | string | No | `created_at` | Sort field | `?sort=name` |
| `order` | string | No | `desc` | Sort direction (`asc` or `desc`) | `?order=asc` |
| `filter_field` | string | No | - | Filter by field value | `?status=active` |

**Request Example:**
```http
GET /api/settlements?page=1&limit=20&status=pending&sort=created_at&order=desc HTTP/1.1
Host: api.fleetneuron.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "field1": "value1",
      "field2": "value2",
      "created_at": "2026-03-08T12:00:00Z",
      "updated_at": "2026-03-08T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

**Error Responses:**

| Status | Code | Description | Example |
|--------|------|-------------|---------|
| 401 | `UNAUTHORIZED` | Missing or invalid token | `{"success": false, "error": "UNAUTHORIZED", "message": "Invalid token"}` |
| 403 | `FORBIDDEN` | Insufficient permissions | `{"success": false, "error": "FORBIDDEN", "message": "Missing required permission: settlements.view"}` |
| 400 | `INVALID_PARAMS` | Invalid query parameters | `{"success": false, "error": "INVALID_PARAMS", "message": "limit must be between 1 and 100"}` |
| 500 | `INTERNAL_ERROR` | Server error | `{"success": false, "error": "INTERNAL_ERROR", "message": "An unexpected error occurred"}` |

---

### 2. Get [Resource] by ID

**Method & Path:** `GET /api/[resource]/:id`

**Description:** Retrieves a single [resource] by its unique ID.

**Authentication:** Required (JWT)

**Authorization:** Requires `[resource].view` permission

**Path Parameters:**

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `id` | integer | Unique resource ID | `/api/settlements/123` |

**Request Example:**
```http
GET /api/settlements/123 HTTP/1.1
Host: api.fleetneuron.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "field1": "value1",
    "field2": "value2",
    "nested_object": {
      "key": "value"
    },
    "array_field": ["item1", "item2"],
    "created_at": "2026-03-08T12:00:00Z",
    "updated_at": "2026-03-08T12:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource with given ID does not exist |
| 500 | `INTERNAL_ERROR` | Server error |

---

### 3. Create [Resource]

**Method & Path:** `POST /api/[resource]`

**Description:** Creates a new [resource].

**Authentication:** Required (JWT)

**Authorization:** Requires `[resource].create` permission

**Request Body:**

| Field | Type | Required | Validation | Description | Example |
|-------|------|----------|------------|-------------|---------|
| `field1` | string | Yes | Max 255 chars | Description | `"value1"` |
| `field2` | integer | No | > 0 | Description | `100` |
| `field3` | array | Yes | Min 1 item | Description | `["item1"]` |
| `field4` | object | No | - | Description | `{"key": "value"}` |

**Request Example:**
```http
POST /api/settlements HTTP/1.1
Host: api.fleetneuron.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "driver_id": 456,
  "start_date": "2026-03-01",
  "end_date": "2026-03-07",
  "notes": "Weekly settlement"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": 789,
    "driver_id": 456,
    "start_date": "2026-03-01",
    "end_date": "2026-03-07",
    "status": "pending",
    "notes": "Weekly settlement",
    "created_at": "2026-03-08T12:00:00Z",
    "updated_at": "2026-03-08T12:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | Description | Example |
|--------|------|-------------|---------|
| 400 | `VALIDATION_ERROR` | Invalid request body | `{"success": false, "error": "VALIDATION_ERROR", "message": "driver_id is required", "fields": {"driver_id": "Required field"}}` |
| 401 | `UNAUTHORIZED` | Missing or invalid token | - |
| 403 | `FORBIDDEN` | Insufficient permissions | - |
| 409 | `CONFLICT` | Resource already exists | `{"success": false, "error": "CONFLICT", "message": "Settlement already exists for this period"}` |
| 500 | `INTERNAL_ERROR` | Server error | - |

---

### 4. Update [Resource]

**Method & Path:** `PUT /api/[resource]/:id`

**Description:** Updates an existing [resource]. Partial updates allowed (only include fields to change).

**Authentication:** Required (JWT)

**Authorization:** Requires `[resource].edit` permission

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | Unique resource ID |

**Request Body:** (All fields optional, only include what you want to update)

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `field1` | string | Max 255 chars | Description |
| `field2` | integer | > 0 | Description |

**Request Example:**
```http
PUT /api/settlements/789 HTTP/1.1
Host: api.fleetneuron.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "status": "approved",
  "approved_by": 123,
  "approved_at": "2026-03-08T14:00:00Z"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 789,
    "driver_id": 456,
    "status": "approved",
    "approved_by": 123,
    "approved_at": "2026-03-08T14:00:00Z",
    "created_at": "2026-03-08T12:00:00Z",
    "updated_at": "2026-03-08T14:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request body |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Update violates business rules |
| 500 | `INTERNAL_ERROR` | Server error |

---

### 5. Delete [Resource]

**Method & Path:** `DELETE /api/[resource]/:id`

**Description:** Deletes a [resource]. This is typically a soft delete (sets `deleted_at` timestamp).

**Authentication:** Required (JWT)

**Authorization:** Requires `[resource].delete` permission (or `[resource].manage`)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | Unique resource ID |

**Request Example:**
```http
DELETE /api/settlements/789 HTTP/1.1
Host: api.fleetneuron.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK or 204 No Content):**
```json
{
  "success": true,
  "message": "Settlement deleted successfully"
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Insufficient permissions |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Cannot delete (e.g., has dependencies) |
| 500 | `INTERNAL_ERROR` | Server error |

---

## Data Models

### [Resource] Object

```typescript
interface Settlement {
  id: number;                    // Unique identifier
  driver_id: number;              // FK to drivers table
  payroll_period_id: number;      // FK to payroll_periods table
  start_date: string;             // ISO 8601 date (YYYY-MM-DD)
  end_date: string;               // ISO 8601 date (YYYY-MM-DD)
  status: 'pending' | 'approved' | 'paid' | 'voided';
  gross_amount: number;           // Total amount before deductions (cents)
  deductions: number;             // Total deductions (cents)
  net_amount: number;             // Amount to pay (cents)
  notes: string | null;           // Optional notes
  approved_by: number | null;     // FK to users table (approver)
  approved_at: string | null;     // ISO 8601 datetime
  paid_at: string | null;         // ISO 8601 datetime
  pdf_url: string | null;         // URL to PDF document
  created_at: string;             // ISO 8601 datetime
  updated_at: string;             // ISO 8601 datetime
  deleted_at: string | null;      // Soft delete timestamp
}
```

### Nested Object: [NestedObject]

```typescript
interface LoadItem {
  load_id: number;
  load_number: string;
  pickup_date: string;
  delivery_date: string;
  loaded_miles: number;
  rate: number;
  driver_pay: number;
}
```

---

## Business Rules

1. **Rule 1:** [Description of a business constraint]
   - Example: A settlement can only be approved once
   - Enforcement: API returns 409 CONFLICT if status is already 'approved'

2. **Rule 2:** [Description]
   - Example: Only users with 'carrier_accountant' or 'admin' role can approve settlements
   - Enforcement: Checked via RBAC middleware

3. **Rule 3:** [Description]
   - Example: Settlements must have at least one load item
   - Enforcement: Validated during creation

---

## Edge Cases & Special Scenarios

### Scenario 1: [Description]
**Input:** [Example]  
**Expected Behavior:** [What should happen]  
**API Response:** [Status code and body]

### Scenario 2: Concurrent Updates
**Input:** Two clients update the same resource simultaneously  
**Expected Behavior:** Last write wins (or use optimistic locking with `version` field)  
**API Response:** 200 OK (or 409 CONFLICT if version mismatch)

---

## Rate Limiting

| Endpoint | Limit | Window | Behavior on Exceed |
|----------|-------|--------|---------------------|
| `GET /api/[resource]` | 100 requests | 1 minute | 429 Too Many Requests |
| `POST /api/[resource]` | 20 requests | 1 minute | 429 Too Many Requests |
| All endpoints | 1000 requests | 1 hour | 429 Too Many Requests |

**Rate Limit Headers:**
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1678291200
```

---

## Caching

| Endpoint | Cache Strategy | TTL | Cache Key |
|----------|----------------|-----|-----------|
| `GET /api/[resource]/:id` | Redis | 5 minutes | `[resource]:{id}` |
| `GET /api/[resource]` | None | - | - |

**Cache Invalidation:**
- On `POST`, `PUT`, `DELETE` operations, cache for affected resource is cleared

---

## Versioning

**Current Version:** v1  
**Path:** `/api/[resource]` (defaults to latest version)  
**Explicit Version:** `/api/v1/[resource]`

**Breaking Changes:** Will increment major version (e.g., v2)  
**Deprecation Policy:** Old versions supported for 6 months after new version release

---

## Testing

### Unit Tests
- [ ] GET list with pagination
- [ ] GET by ID (success and not found)
- [ ] POST with valid data
- [ ] POST with invalid data (validation errors)
- [ ] PUT with partial update
- [ ] DELETE (soft delete)
- [ ] Permission checks (401, 403)

### Integration Tests
- [ ] End-to-end flow: Create → Retrieve → Update → Delete
- [ ] Concurrent updates
- [ ] Rate limiting
- [ ] Cache behavior

### Test Data
```json
{
  "valid_create_payload": {
    "driver_id": 456,
    "start_date": "2026-03-01",
    "end_date": "2026-03-07"
  },
  "invalid_create_payload": {
    "driver_id": "not-a-number",
    "start_date": "invalid-date"
  }
}
```

---

## Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2026-03-08 | 1.0 | Initial contract | Backend AI |
| 2026-03-10 | 1.1 | Added `notes` field to settlement | Backend AI |

---

## Open Questions

- [ ] **Q1:** Should we support bulk delete? (e.g., `DELETE /api/[resource]?ids=1,2,3`)
  - **Decision:** TBD
  - **Decided By:** Team discussion
  - **Date:** -

- [ ] **Q2:** What should happen if a user tries to approve their own settlement?
  - **Decision:** TBD
  - **Decided By:** Product owner
  - **Date:** -

---

## Feedback & Approval

### Frontend AI Feedback
- [ ] Contract reviewed
- [ ] All fields needed for UI are present
- [ ] Pagination/filtering sufficient
- **Comments:** [Any requests or suggestions]

### iOS AI Feedback
- [ ] Contract reviewed
- [ ] Mobile-specific needs addressed (e.g., smaller payloads)
- **Comments:** [Any requests or suggestions]

### Android AI Feedback
- [ ] Contract reviewed
- [ ] Mobile-specific needs addressed
- **Comments:** [Any requests or suggestions]

### Approval
- [ ] **Backend AI:** Contract complete and ready to implement
- [ ] **UI/UX AI:** Approved for frontend integration
- [ ] **iOS AI:** Approved for iOS integration
- [ ] **Android AI:** Approved for Android integration

**Final Approval Date:** [Date]

---

## Implementation Checklist

- [ ] Backend route implemented in `backend/microservices/[service]/routes/[resource].js`
- [ ] Business logic in `backend/microservices/[service]/services/[resource]-service.js`
- [ ] Auth middleware applied
- [ ] Permission checks implemented
- [ ] Input validation added
- [ ] Error handling complete
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] API documentation updated (Swagger/OpenAPI)
- [ ] Postman/Insomnia collection updated
- [ ] Frontend service created (if applicable)
- [ ] iOS service created (if applicable)
- [ ] Android service created (if applicable)

---

**Related Documents:**
- [Backend Analysis](/docs/BACKEND-ANALYSIS-AND-COLLABORATION-STRATEGY.md)
- [RBAC Documentation](/docs/RBAC.md)
- [Git Workflow](/docs/GIT-WORKFLOW-QUICK-REFERENCE.md)

**Questions?** Update the "Open Questions" section or reach out in `/docs/TEAM-STATUS-DAILY.md`
