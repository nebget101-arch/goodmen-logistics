/**
 * Annual compliance models for FMCSA driver compliance tracking.
 * CFR References: §391.25, §382.701(b), §391.43
 */

export type ComplianceItemType =
  | 'mvr_inquiry'
  | 'driving_record_review'
  | 'clearinghouse_query'
  | 'medical_cert';

export type ComplianceItemStatus =
  | 'complete'
  | 'due_soon'
  | 'overdue'
  | 'pending';

export type MedicalCertUrgency =
  | 'valid'       // >90 days
  | 'warning'     // 30–90 days
  | 'critical'    // <30 days
  | 'expired';

export interface ComplianceDashboardSummary {
  totalDrivers: number;
  fullyCompliantCount: number;
  fullyCompliantPercent: number;
  overdueCount: number;
  dueSoonCount: number;
  medicalCertsExpiring30: number;
  medicalCertsExpiring60: number;
  medicalCertsExpiring90: number;
}

export interface ComplianceGridRow {
  driverId: string;
  driverName: string;
  mvrInquiry: ComplianceCellStatus;
  drivingRecordReview: ComplianceCellStatus;
  clearinghouseQuery: ComplianceCellStatus;
  medicalCert: ComplianceCellStatus;
  overallStatus: ComplianceItemStatus;
}

export interface ComplianceCellStatus {
  status: ComplianceItemStatus;
  dueDate: string | null;
  completedDate: string | null;
  itemId: string | null;
}

export interface MedicalExpiryRow {
  driverId: string;
  driverName: string;
  cdlNumber: string;
  expiryDate: string;
  daysRemaining: number;
  urgency: MedicalCertUrgency;
}

export interface ComplianceItem {
  id: string;
  driverId: string;
  type: ComplianceItemType;
  year: number;
  status: ComplianceItemStatus;
  dueDate: string;
  completedDate: string | null;
  reviewerName: string | null;
  determination: string | null;
  notes: string | null;
  documentIds: string[];
}

export interface CompleteItemPayload {
  reviewerName: string;
  notes: string;
  determination: string;
}

export interface DriverComplianceResponse {
  driverId: string;
  driverName: string;
  year: number;
  items: ComplianceItem[];
}

export interface OverdueItem {
  itemId: string;
  driverId: string;
  driverName: string;
  type: ComplianceItemType;
  dueDate: string;
  daysPastDue: number;
}

export interface UpcomingItem {
  itemId: string;
  driverId: string;
  driverName: string;
  type: ComplianceItemType;
  dueDate: string;
  daysUntilDue: number;
}
