export interface GuidedQuestionMeta {
  id: string;
  section: string;
  step: number;
  total_steps: number;
  prompt: string;
}

const QUESTION_META: Omit<GuidedQuestionMeta, 'step' | 'total_steps'>[] = [
  {
    id: 'project_intent',
    section: 'Project Intent',
    prompt: 'What is the main reason you want to build this ADU?',
  },
  {
    id: 'design_approach',
    section: 'Design Approach',
    prompt: 'How do you want to approach the ADU design?',
  },
  {
    id: 'budget_readiness',
    section: 'Budget Readiness',
    prompt: 'How should the report describe your current budget readiness?',
  },
  {
    id: 'site_concerns',
    section: 'Site Concerns',
    prompt: 'Which site conditions should the report pay special attention to?',
  },
  {
    id: 'permit_timeline',
    section: 'Permit / Timeline',
    prompt: 'What timeline or permit goal should guide the next steps?',
  },
  {
    id: 'rental_operations',
    section: 'Rental Operations',
    prompt: 'If this ADU may be rented, what operating assumptions should the report include?',
  },
];

export const GUIDED_QUESTION_METADATA: GuidedQuestionMeta[] = QUESTION_META.map((q, i) => ({
  ...q,
  step: i + 1,
  total_steps: QUESTION_META.length,
}));
