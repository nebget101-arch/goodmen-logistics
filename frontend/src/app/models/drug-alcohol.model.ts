/** Drug & Alcohol test management models — FN-214 */

export type DrugTestType =
  | 'pre_employment'
  | 'random'
  | 'reasonable_suspicion'
  | 'post_accident'
  | 'return_to_duty'
  | 'follow_up';

export type SubstanceType = 'drug' | 'alcohol' | 'both';

export type DrugTestResult =
  | 'negative'
  | 'positive'
  | 'refused'
  | 'cancelled'
  | 'invalid';

export type ClearinghouseReportingStatus = 'reported' | 'not_reported';

export interface DrugTestPanelDetails {
  marijuana: boolean;
  cocaine: boolean;
  opiates: boolean;
  amphetamines: boolean;
  pcp: boolean;
}

export interface DrugAlcoholTest {
  id?: string;
  driver_id: string;
  test_type: DrugTestType;
  substance_type: SubstanceType;
  panel_details?: DrugTestPanelDetails;
  collection_site?: string;
  collection_date?: string;
  lab_name?: string;
  mro_name?: string;
  mro_verified?: boolean;
  ccf_number?: string;
  result?: DrugTestResult;
  clearinghouse_reported?: ClearinghouseReportingStatus;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ClearanceRequirement {
  key: string;
  label: string;
  met: boolean;
  link?: string;
}

export interface ClearanceStatus {
  cleared: boolean;
  requirements: ClearanceRequirement[];
  missingItems: string[];
}

export const DRUG_TEST_TYPE_LABELS: Record<DrugTestType, string> = {
  pre_employment: 'Pre-Employment',
  random: 'Random',
  reasonable_suspicion: 'Reasonable Suspicion',
  post_accident: 'Post-Accident',
  return_to_duty: 'Return-to-Duty',
  follow_up: 'Follow-Up'
};

export const SUBSTANCE_TYPE_LABELS: Record<SubstanceType, string> = {
  drug: 'Drug',
  alcohol: 'Alcohol',
  both: 'Both'
};

export const DRUG_TEST_RESULT_LABELS: Record<DrugTestResult, string> = {
  negative: 'Negative',
  positive: 'Positive',
  refused: 'Refused',
  cancelled: 'Cancelled',
  invalid: 'Invalid'
};
