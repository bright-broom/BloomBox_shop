/** Request-bound authenticated operator; no browser-selected bucket or exemption for retries. */
export interface ApprovalSubmissionLimiter {
  consume(): Promise<void>;
}
