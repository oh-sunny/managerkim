import {BRIEF_LABELS, makeNoticeBrief} from './notice-draft.js';

const EDIT_FIELDS = Object.freeze({
  what: ['name'], audience: ['audience', 'targetIds'], action: ['requirements'],
  deadline: ['deadlineAt'], schedule: ['event', 'location'], method: ['requirements', 'applicationUrl'],
  cost: ['requirements'], exception: ['requirements', 'capacity', 'confirmationMode'],
  contact: ['owner'], links: ['applicationUrl'],
});

/** Build a save-review view from current project values; no separate card version is stored. */
export function buildRegistrationSummary(project) {
  const brief = makeNoticeBrief(project);
  const rows = Object.entries(BRIEF_LABELS).map(([key, label]) => {
    const fact = brief[key];
    const fields = EDIT_FIELDS[key];
    const unresolved = (project?.sourceIssues || []).find(issue => fields.includes(issue.field));
    const selectedConflict = fact.status === 'conflict' && (project?.sourceReviews || [])
      .some(review => fields.includes(review.field) && review.status === 'conflict' && review.appliedValue);
    const status = unresolved?.status === 'conflict' ? 'conflict'
      : unresolved ? 'needs_review' : selectedConflict ? 'confirmed' : fact.status;
    return {key, label, value: fact.value, source: fact.source, evidence: fact.evidence,
      status, editFields: fields, needsReview: status !== 'confirmed'};
  });
  return {rows, needsReview: rows.filter(row => row.needsReview), ready: rows.every(row => !row.needsReview)};
}
