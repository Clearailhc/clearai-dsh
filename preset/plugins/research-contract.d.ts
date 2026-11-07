export type ResearchWorkflow = 'agent-v1' | 'steps-v1'
export interface ReviewClaimsRequest {
 claims: string[]
 observations: Array<{ ref: string; note?: string }>
 level?: 'L3' | 'L4'
}
export interface AnswerClaimReferences {
 /** Registered hypotheses whose coverage the answer requires. */
 claims?: string[]
 /** Existing independently verified facts actually used in this scope. */
 uses?: string[]
}
export interface ReviewCoverage {
 policy: 'clearai.review.v1' | 'clearai.review.v2'
 obligation?: ReviewObligation | null
 digest: string
 claims: Array<{ id: string; version: string | number | null; scope: unknown; refute_when: string | null }>
 criteria: Array<{ id: string; text: string }>
 trust: Record<string, unknown>
 scope: Record<string, unknown>
}

export interface ReviewImpact {
 touches?: string[]
 impact_basis?: string
}
export interface ClaimReviewResult {
 hypothesis: string
 verdict: 'support' | 'refute' | 'inconclusive'
 independent_of_open_issues?: boolean
 basis?: string
}

export interface ReviewObligation {
 policy: 'clearai.review.v2'
 kind: string
 scope: 'selected-work' | 'final-delivery'
 criteria: string
 claims: string[]
 goal_context: { id: string | null; claim: string | null; done_criteria: string | null }
 final_delivery_required_now: boolean
}
