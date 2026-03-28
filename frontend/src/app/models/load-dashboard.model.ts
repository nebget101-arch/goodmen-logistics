export type LoadStatus =
  | 'NEW'
  | 'DRAFT'
  | 'CANCELLED'
  | 'CANCELED'
  | 'TONU'
  | 'DISPATCHED'
  | 'EN_ROUTE'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED';
export type BillingStatus =
  | 'PENDING'
  | 'CANCELLED'
  | 'CANCELED'
  | 'BOL_RECEIVED'
  | 'INVOICED'
  | 'SENT_TO_FACTORING'
  | 'FUNDED'
  | 'PAID';
export type LoadStopType = 'PICKUP' | 'DELIVERY';
export type LoadAttachmentType =
  | 'RATE_CONFIRMATION'
  | 'BOL'
  | 'LUMPER'
  | 'OTHER'
  | 'CONFIRMATION'
  | 'PROOF_OF_DELIVERY'
  | 'ROADSIDE_MAINTENANCE_RECEIPT';

export interface LoadListItem {
  id: string;
  load_number: string;
  status: LoadStatus;
  billing_status: BillingStatus;
  rate: number | null;
  completed_date: string | null;
  pickup_date?: string | null;
  delivery_date?: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_zip?: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_zip?: string | null;
  driver_name: string | null;
  broker_name: string | null;
  po_number?: string | null;
  attachment_count: number;
  attachment_types: LoadAttachmentType[];
  notes?: string | null;
}

export interface LoadStop {
  id?: string;
  load_id?: string;
  stop_type: LoadStopType;
  stop_date?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  address1?: string | null;
  address2?: string | null;
  sequence?: number | null;
}

export interface LoadAttachment {
  id: string;
  load_id: string;
  type: LoadAttachmentType;
  file_name: string;
  storage_key?: string | null;
  file_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  notes?: string | null;
  uploaded_by_user_id?: string | null;
  created_at: string;
}

/** Audit log entry for load history tab. */
export interface LoadHistoryEntry {
  date: string;
  description: string;
  author?: string | null;
}

export interface LoadDetail extends LoadListItem {
  dispatcher_user_id?: string | null;
  driver_id?: string | null;
  truck_id?: string | null;
  trailer_id?: string | null;
  broker_id?: string | null;
  broker_display_name?: string | null;
  /** Driver position before picking up this load (from loads API). */
  driver_position_city?: string | null;
  driver_position_state?: string | null;
  stops: LoadStop[];
  attachments: LoadAttachment[];
  /** Audit log for the load (optional until backend supports it). */
  history?: LoadHistoryEntry[];
  // Optional trip metrics – can be populated by backend
  total_miles?: number | null;
  loaded_miles?: number | null;
  empty_miles?: number | null;
  rate_per_mile?: number | null;
  /** Previous load's last delivery city (for empty miles origin context). */
  prev_delivery_city?: string | null;
  /** Previous load's last delivery state (for empty miles origin context). */
  prev_delivery_state?: string | null;
}

export interface LoadsListResponse {
  success: boolean;
  data: LoadListItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface LoadAiEndpointExtractionStop {
  type: 'PICKUP' | 'DELIVERY';
  sequence?: number;
  date?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  address1?: string | null;
}

export interface LoadAiEndpointExtraction {
  brokerName: string | null;
  poNumber: string | null;
  loadId?: string | null;
  orderId?: string | null;
  proNumber?: string | null;
  rate: number | null;
  pickup: {
    date: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    address1: string | null;
  };
  delivery: {
    date: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    address1: string | null;
  };
  stops?: LoadAiEndpointExtractionStop[];
  notes: string | null;
  confidence?: {
    brokerName?: number;
    poNumber?: number;
    rate?: number;
    pickup?: number;
    delivery?: number;
  };
  rawTextSnippet?: string | null;
  provider?: string;
  model?: string;
  warning?: string;
}

