## AI Assistant Failure Diagnosis Playbooks (v1)

These playbooks describe common issues users encounter and the recommended guidance patterns for the AI assistant.

### 1. Work Orders – Cannot Close / Stuck in Status

**User symptoms**
- \"I can't close this work order.\"
- \"Why is this work order still open or in progress?\"

**Likely causes**
- Required fields are missing (location, vehicle, customer).
- There are outstanding parts (backordered or not issued).
- Work order status is not in a state that can transition to CLOSED.

**Assistant guidance pattern**
- Ask which work order the user is referring to if not obvious.
- Explain that:
  - Work orders typically move from DRAFT/OPEN → IN_PROGRESS → WAITING_PARTS → COMPLETED → CLOSED.
  - They cannot be closed if required context (vehicle, location, customer) is missing.
- Checklist for the user:
  1. Open the work order details.
  2. Confirm **vehicle**, **customer**, and **shop location** are set.
  3. Review **parts** section:
     - Ensure that any backordered or reserved lines are updated or issued as needed.
  4. Ensure the work order is set to a completed status before closing.

### 2. Inventory / Parts – Barcode Not Found

**User symptoms**
- \"I scanned a barcode and nothing happened.\"
- \"Why can't the system find this barcode?\"

**Likely causes**
- Barcode is not linked to a part in the catalog.
- Barcode type or format is not supported.
- Wrong warehouse/location filter.

**Assistant guidance pattern**
- Explain the normal flow:
  - Scan bridge or desktop upload → `/api/barcodes/{code}` → part + inventory lookup.
- Checklist for the user:
  1. Verify the barcode is correctly printed and complete.
  2. Check that the part exists in the parts catalog.
  3. Confirm that at least one barcode is associated with the part.
  4. If applicable, retry with a different location filter or without a location filter.
- Suggest next steps:
  - If no mapping exists, add the part to the catalog and create a barcode mapping.

### 3. Drivers / Onboarding – Packet Not Sent

**User symptoms**
- \"My driver did not receive the onboarding packet.\"
- \"The onboarding packet says 'failed to send'.\"

**Likely causes**
- Missing or invalid phone number or email.
- Driver record missing contact information.
- Temporary email/SMS provider issues.

**Assistant guidance pattern**
- Checklist for the user:
  1. Open the driver record and verify **phone** and **email**.
  2. Confirm the chosen delivery channel (SMS, email, both) in the Send Packet modal.
  3. Check that phone/email do not have obvious typos.
  4. If issue persists, try sending via the alternate channel.

### 4. Integrations – Data Not Syncing

**User symptoms**
- \"Why are my loads/invoices not syncing?\"
- \"This integration shows as connected but no data appears.\"

**Likely causes**
- Missing required API keys or credentials.
- Incomplete initial configuration (e.g. mapping, webhooks).
- Integration is paused, disabled, or rate-limited.

**Assistant guidance pattern**
- Ask which integration and what data they expect (loads, invoices, GPS, etc.).
- Checklist for the user:
  1. Open the integration settings page for the provider.
  2. Verify required fields are filled (API key, client id/secret, webhook URL, etc.).
  3. Confirm integration status is active/enabled.
  4. Check the most recent sync or error messages on the integration page, if available.
- Recommend contacting support if configuration looks correct but sync has been failing for an extended period.

