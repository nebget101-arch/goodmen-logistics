// FN-1594 — types shared across the loads-import wizard, service, and modal.
// The backend contract is delivered by FN-1584; the shapes below describe the
// fields the wizard reads. New optional fields can be added without breaking
// the wizard.

export interface LoadsImportFieldDef {
  key: string;
  label: string;
  required: boolean;
  group: 'load' | 'pickup' | 'delivery' | 'meta';
}

export const LOADS_IMPORT_FIELDS: LoadsImportFieldDef[] = [
  { key: 'load_number',      label: 'Load #',           required: true,  group: 'load' },
  { key: 'broker_name',      label: 'Broker',           required: false, group: 'load' },
  { key: 'rate',             label: 'Rate',             required: false, group: 'load' },
  { key: 'pickup_date',      label: 'Pickup Date',      required: true,  group: 'pickup' },
  { key: 'pickup_city',      label: 'Pickup City',      required: false, group: 'pickup' },
  { key: 'pickup_state',     label: 'Pickup State',     required: false, group: 'pickup' },
  { key: 'pickup_zip',       label: 'Pickup ZIP',       required: false, group: 'pickup' },
  { key: 'pickup_address',   label: 'Pickup Address',   required: false, group: 'pickup' },
  { key: 'delivery_date',    label: 'Delivery Date',    required: true,  group: 'delivery' },
  { key: 'delivery_city',    label: 'Delivery City',    required: false, group: 'delivery' },
  { key: 'delivery_state',   label: 'Delivery State',   required: false, group: 'delivery' },
  { key: 'delivery_zip',     label: 'Delivery ZIP',     required: false, group: 'delivery' },
  { key: 'delivery_address', label: 'Delivery Address', required: false, group: 'delivery' },
  { key: 'driver_name',      label: 'Driver',           required: false, group: 'meta' },
  { key: 'truck_unit',       label: 'Truck Unit',       required: false, group: 'meta' },
  { key: 'trailer_unit',     label: 'Trailer Unit',     required: false, group: 'meta' },
  { key: 'notes',             label: 'Notes',            required: false, group: 'meta' },
];

export type MultiStopPattern = 'single' | 'multi';

export interface AiColumnSuggestion {
  rawHeader: string | null;
  confidence: number;
}

export interface ImportPreviewResponse {
  headers: string[];
  totalRows: number;
  preview: Array<{ raw: Record<string, string> }>;
  /** AI-suggested mapping per FN field. Confidence is 0..1. */
  aiMapping?: Record<string, AiColumnSuggestion>;
  /** AI-detected multi-stop pattern; user can override. */
  multiStopPattern?: MultiStopPattern;
  /** Optional overall confidence — null when AI is unavailable. */
  overallConfidence?: number;
  /** Backend may flag low-confidence rows for the user to inspect. */
  flaggedRows?: Array<{ rowNumber: number; reason: string; confidence: number }>;
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
