// Types shared across the loads-import wizard, service, and modal.
// Field names mirror the canonical wire shape produced by the AI handler
// (FN-1585) and the loads-import-service preview/stage/commit flow.

export interface LoadsImportFieldDef {
  key: string;
  label: string;
  required: boolean;
  group: 'load' | 'pickup' | 'delivery' | 'meta';
}

export const LOADS_IMPORT_FIELDS: LoadsImportFieldDef[] = [
  { key: 'load_number',       label: 'Load #',           required: true,  group: 'load' },
  { key: 'po_number',         label: 'PO #',             required: false, group: 'load' },
  { key: 'broker_name',       label: 'Broker',           required: false, group: 'load' },
  { key: 'broker_mc',         label: 'Broker MC',        required: false, group: 'load' },
  { key: 'broker_dot',        label: 'Broker DOT',       required: false, group: 'load' },
  { key: 'rate',              label: 'Rate',             required: false, group: 'load' },
  { key: 'pickup_date',       label: 'Pickup Date',      required: true,  group: 'pickup' },
  { key: 'pickup_city',       label: 'Pickup City',      required: false, group: 'pickup' },
  { key: 'pickup_state',      label: 'Pickup State',     required: false, group: 'pickup' },
  { key: 'pickup_zip',        label: 'Pickup ZIP',       required: false, group: 'pickup' },
  { key: 'pickup_address1',   label: 'Pickup Address',   required: false, group: 'pickup' },
  { key: 'delivery_date',     label: 'Delivery Date',    required: true,  group: 'delivery' },
  { key: 'delivery_city',     label: 'Delivery City',    required: false, group: 'delivery' },
  { key: 'delivery_state',    label: 'Delivery State',   required: false, group: 'delivery' },
  { key: 'delivery_zip',      label: 'Delivery ZIP',     required: false, group: 'delivery' },
  { key: 'delivery_address1', label: 'Delivery Address', required: false, group: 'delivery' },
  { key: 'driver_name',       label: 'Driver',           required: false, group: 'meta' },
  { key: 'truck_unit',        label: 'Truck Unit',       required: false, group: 'meta' },
  { key: 'trailer_unit',      label: 'Trailer Unit',     required: false, group: 'meta' },
  { key: 'status',            label: 'Status',           required: false, group: 'meta' },
  { key: 'billing_status',    label: 'Billing Status',   required: false, group: 'meta' },
  { key: 'notes',             label: 'Notes',            required: false, group: 'meta' },
];

export type MultiStopPattern = 'single' | 'multi_row' | 'extra_columns' | 'free_text';

export interface AiColumnSuggestion {
  sourceHeader: string | null;
  confidence: number;
}

export interface ImportPreviewResponse {
  batchId: string;
  headers: string[];
  totalRows: number;
  /** First N rows as header→value objects, exactly as the AI handler sees them. */
  sampleRows: Record<string, string>[];
  /** AI-suggested mapping per FN field. Confidence is 0..1. */
  columnMapping?: Record<string, AiColumnSuggestion> | null;
  /** AI-detected multi-stop pattern; user can override. */
  multiStopPattern?: MultiStopPattern | null;
  /** AI's suggested raw-string → canonical status mapping (e.g. "DEL" → "delivered"). */
  statusEnumMapping?: Record<string, string> | null;
  billingStatusEnumMapping?: Record<string, string> | null;
  /** True when the AI service was unreachable or returned a fallback. */
  aiUnavailable?: boolean;
  /** Optional overall confidence — null when AI is unavailable. */
  overallConfidence?: number | null;
  /** Backend may flag low-confidence rows for the user to inspect. */
  flaggedRows?: Array<{ rowNumber: number; reason: string; confidence: number }>;
  /** AI-emitted warnings (e.g. FREETEXT_STOPS). */
  warnings?: Array<{ code: string; message: string } | string>;
  /** Backend may include a cache-hit hint (saved per-broker template). */
  cacheHit?: boolean;
}

export type StageRowOutcome = 'ok' | 'needs_review' | 'error';

export interface StageRow {
  rowNumber: number;
  outcome: StageRowOutcome;
  loadNumber?: string | null;
  brokerName?: string | null;
  pickupCity?: string | null;
  deliveryCity?: string | null;
  pickupDate?: string | null;
  deliveryDate?: string | null;
  rate?: number | string | null;
  errors?: string[];
  warnings?: string[];
}

export interface StageResponse {
  batchId: string;
  totalRows: number;
  okCount: number;
  needsReviewCount: number;
  errorCount: number;
  rows: StageRow[];
}

export interface CommitDuplicate {
  rowNumber: number;
  attemptedLoadNumber: string;
  existingLoadId?: string | null;
  rate?: number | string | null;
  brokerName?: string | null;
  pickupCity?: string | null;
  deliveryCity?: string | null;
}

export interface CommitResponse {
  batchId: string;
  autoCreatedCount: number;
  needsReviewCount: number;
  duplicatesSkippedCount: number;
  errorCount: number;
  duplicates: CommitDuplicate[];
  errors?: Array<{ rowNumber: number; message: string }>;
  /** Optional progress hint for very large batches. */
  totalProcessed?: number;
}

export interface ImportBatchSummary {
  id: string;
  createdAt: string;
  fileName: string;
  totalRows: number;
  status: string;
  autoCreatedCount?: number;
  needsReviewCount?: number;
  duplicatesSkippedCount?: number;
  errorCount?: number;
}
