export interface RequirementOption {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
  normalized_value: Record<string, unknown>;
}

export interface RequirementQuestion {
  id: string;
  section: string;
  step: number;
  total_steps: number;
  title: string;
  prompt: string;
  expected_fields: string[];
  options: RequirementOption[];
  allow_custom_answer: boolean;
  placeholder: string;
  status?: 'unanswered' | 'answered' | 'needs_review';
  answered?: boolean;
  answer?: string | null;
  selected_option_id?: string | null;
}

export interface RequirementQuestionsResponse {
  questions: RequirementQuestion[];
}

export interface RequirementAnswerPayload {
  question_id: string;
  selected_option_id: string | null;
  custom_answer: string | null;
  expected_version: number | null;
}

export interface RequirementAnswerResponse {
  // null when preloaded=true (answer stored as a preload; no report exists yet)
  report: ReportData | null;
  preloaded: boolean;
  accepted: boolean;
  status: 'answered' | 'needs_clarification';
  normalized_value: Record<string, unknown>;
  missing_fields: string[];
  clarification_prompt: string | null;
}

export interface RequirementItem {
  id: string;
  title: string;
  question: string;
  answer: string;
  selected_option_id?: string | null;
  status: 'answered' | 'needs_review';
  updated_at?: string | null;
}

export interface ReportData {
  id: string;
  project_id: string;
  version: number;
  visible?: {
    executive_summary?: string | null;
    property_overview?: string | null;
    zoning_analysis?: string | null;
    financial_snapshot?: string | null;
    recommendations?: string | null;
    requirements?: RequirementItem[] | null;
  } | null;
  context?: Record<string, unknown> | null;
  created_at: string;
  last_modified: string;
}
