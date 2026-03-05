# Barcode Scanning & Phone Bridge – API Reference for UI

Base URL: same as your app API (e.g. `http://localhost:4000` in dev, or your gateway URL in production). All scan-bridge and barcode endpoints are proxied through the gateway.

---

## 1. Phone Bridge (existing – keep as-is)

Use this so a user can open a page on their phone/tablet, scan barcodes (live camera or take photo), and have scans appear on the desktop session.

### 1.1 Create session (desktop, authenticated)

**Request**

- **Method:** `POST`
- **URL:** `/api/scan-bridge/session`
- **Headers:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`
- **Body:** `{}` (empty object)

**Response (201)**

```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "writeToken": "hex-string",
    "readToken": "hex-string",
    "mobileUrl": "https://your-host/api/scan-bridge/mobile?session=...&writeToken=...",
    "expiresInSeconds": 1800
  }
}
```

**UI usage**

- Show a QR code or link for `data.mobileUrl`.
- User opens `mobileUrl` on phone/tablet to get the scanner page (live camera + manual input + take photo).

---

### 1.2 Listen for scans (desktop, Server-Sent Events)

**Request**

- **Method:** `GET`
- **URL:** `/api/scan-bridge/session/{sessionId}/events?readToken={readToken}`
- **Headers:** none (no auth for SSE)
- **Query:** `readToken` from create-session response

**Response**

- **Content-Type:** `text/event-stream`
- **Events:**
  - `ready` – connection ready
  - `ping` – keepalive (optional to handle)
  - `scan` – new barcode received from phone (use this for UI)

**Scan event payload**

- **Event type:** `scan`
- **Data (JSON):** `{ "barcode": "1234567890123", "timestamp": "2026-03-05T12:00:00.000Z" }`

**UI usage**

- Use `EventSource` (or similar) with the URL above.
- On each `scan` event, parse `event.data` as JSON and use `barcode` to update your list / form (e.g. add to scan batch, lookup part, etc.).

---

### 1.3 Send barcode from phone (mobile page – already implemented)

The mobile page at `mobileUrl` can send a barcode to the desktop with:

- **Method:** `POST`
- **URL:** `/api/scan-bridge/session/{sessionId}/scan`
- **Headers:** `Content-Type: application/json`
- **Body:** `{ "writeToken": "<writeToken>", "barcode": "<string>" }`

**Response (201)**

```json
{
  "success": true,
  "data": {
    "barcode": "1234567890123",
    "timestamp": "2026-03-05T12:00:00.000Z"
  }
}
```

The desktop receives the same barcode via the SSE `scan` event (see 1.2). The UI agent does not need to implement this POST from the main app; the backend-served mobile page handles it (and the “Take photo” flow below).

---

## 2. Decode barcode from image (backend does the decoding)

Two endpoints: one for **authenticated** desktop “upload image”, one for **phone/tablet** “take photo” that also pushes the result into the bridge.

---

### 2.1 Desktop: decode from uploaded image (authenticated)

Use when the user uploads or picks an image file on the **desktop** (e.g. “Upload photo” in warehouse/inventory).

**Request**

- **Method:** `POST`
- **URL:** `/api/barcodes/decode-image`
- **Headers:** `Authorization: Bearer <JWT>`
- **Body:** `multipart/form-data` with one file:
  - **Field name:** `image`
  - **Content:** image file (JPEG, PNG, etc.; max 10 MB)

**Response (200) – barcode found**

```json
{
  "success": true,
  "data": {
    "barcode": "1234567890123",
    "format": "code-128"
  }
}
```

**Response (200) – no barcode in image**

```json
{
  "success": true,
  "data": {
    "barcode": null,
    "format": null
  }
}
```

**Errors**

- **400** – Missing image: `{ "success": false, "error": "No image uploaded; use field name \"image\"." }`
- **401** – Not authenticated
- **500** – Decode failed: `{ "success": false, "error": "Failed to decode barcode from image." }`

**UI usage**

- File input (or drag-and-drop) → build `FormData`, append file with key `image` → POST to `/api/barcodes/decode-image` with the JWT.
- On success, use `data.barcode` (or show “No barcode found” when `data.barcode === null`) and integrate into your flow (e.g. add to scan list, run barcode lookup).

---

### 2.2 Phone/tablet: take photo and send to bridge (no auth)

Used by the **mobile scanner page** when the user taps “Take photo / Choose image”. The backend decodes the barcode and **pushes it to the bridge** so the desktop gets it via SSE. The main app UI only needs to consume the SSE `scan` event; no extra UI integration for this POST.

**Request (for reference – mobile page implements this)**

- **Method:** `POST`
- **URL:** `/api/scan-bridge/decode-image`
- **Headers:** none (no auth)
- **Body:** `multipart/form-data`:
  - **Field name:** `image` – image file (camera or gallery)
  - **Field name:** `writeToken` – from create-session response
  - **Field name:** `sessionId` – from create-session response

**Response (201) – barcode decoded and pushed to desktop**

```json
{
  "success": true,
  "data": {
    "barcode": "1234567890123",
    "format": "ean-13"
  },
  "pushed": true
}
```

**Response (200) – no barcode in image**

```json
{
  "success": true,
  "data": { "barcode": null },
  "pushed": false
}
```

**Errors**

- **400** – No image: `{ "success": false, "error": "No image uploaded; use field name \"image\"." }`
- **403** – Invalid write token
- **404** – Session not found or expired
- **500** – Decode failed

**UI usage**

- Desktop UI: no change. Keep using the **SSE** `scan` event; the mobile page and this endpoint handle “take photo” and pushing the barcode into the same bridge.

---

## 3. Barcode lookup (existing – for inventory)

After you have a barcode string (from bridge SSE, decode-image, or manual input), you can resolve it to part + inventory.

**Request**

- **Method:** `GET`
- **URL:** `/api/barcodes/{code}`
- **Headers:** `Authorization: Bearer <JWT>`
- **Query (optional):** `location_id` or `locationId` – filter inventory by location

**Response (200)**

```json
{
  "success": true,
  "data": {
    "barcode": {
      "id": "uuid",
      "barcode_value": "1234567890123",
      "part_id": "uuid",
      "pack_qty": 1,
      "vendor": null
    },
    "part": {
      "id": "uuid",
      "sku": "TRK-001",
      "name": "Part Name",
      "category": "Category",
      "unit_price": "10.00",
      "unit_cost": "8.00",
      "default_retail_price": "12.00",
      "default_cost": "8.00",
      "taxable": true
    },
    "inventory_by_location": [
      {
        "location_id": "uuid",
        "location_name": "Main Warehouse",
        "on_hand_qty": 50,
        "reserved_qty": 2,
        "available_qty": 48
      }
    ]
  }
}
```

**Errors**

- **400** – Missing code
- **404** – Barcode not found
- **401** – Not authenticated

---

## 4. Summary for UI agent

| Flow | Endpoint | Auth | Purpose |
|------|----------|------|--------|
| Start phone scanner | `POST /api/scan-bridge/session` | JWT | Get `mobileUrl`, `sessionId`, `readToken`, `writeToken` |
| Receive scans on desktop | `GET /api/scan-bridge/session/{sessionId}/events?readToken=...` | none | SSE; listen for `scan` events |
| Decode from file (desktop) | `POST /api/barcodes/decode-image` | JWT | Upload image, get `barcode` + `format` |
| Lookup barcode | `GET /api/barcodes/{code}` | JWT | Resolve barcode to part + inventory |

**Implement in UI**

1. **Phone bridge**
   - On “Scan with phone”: call `POST /api/scan-bridge/session`, show QR/link from `data.mobileUrl`, open `EventSource` for `data.sessionId` + `data.readToken`.
   - On each SSE `scan` event: parse `event.data`, take `barcode`, then add to your list and/or call `GET /api/barcodes/{barcode}` for part/inventory.

2. **Desktop “Upload image”**
   - File input → `FormData` with key `image` → `POST /api/barcodes/decode-image` with JWT.
   - Use response `data.barcode` (or “No barcode found”) and optionally `GET /api/barcodes/{barcode}` for part/inventory.

3. **Existing manual / USB scanner**
   - When the user types or scans into a field, take the barcode string and call `GET /api/barcodes/{code}` as today. No API changes.

Supported barcode formats (decode-image): Code-128, EAN-13, Code-39, EAN-8, UPC-A, UPC-E, Code-93, Codabar.
