export type LoadStatus = 'NEW' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
export type BillingStatus = 'PENDING' | 'FUNDED' | 'INVOICED' | 'PAID';
export type LoadStopType = 'PICKUP' | 'DELIVERY';
export type LoadAttachmentType = 'RATE_CONFIRMATION' | 'BOL' | 'LUMPER' | 'OTHER' | 'CONFIRMATION';

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
  delivery_city: string | null;
  delivery_state: string | null;
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

export interface LoadDetail extends LoadListItem {
  dispatcher_user_id?: string | null;
  driver_id?: string | null;
  truck_id?: string | null;
  trailer_id?: string | null;
  broker_id?: string | null;
  broker_display_name?: string | null;
  stops: LoadStop[];
  attachments: LoadAttachment[];
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

export interface LoadAiEndpointExtraction {
  brokerName: string | null;
  poNumber: string | null;
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

