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
 policy: 'clearai.review.v1'
 digest: string
 claims: Array<{ id: string; version: string | number | null; scope: unknown; refute_when: string | null }>
 criteria: Array<{ id: string; text: string }>
 trust: Record<string, unknown>
 scope: Record<string, unknown>
}
