export type ApprovalFormState = Readonly<{
  status: "IDLE" | "RECORDED" | "DUPLICATE" | "INVALID_REQUEST" | "NOT_AUTHORIZED" | "REVIEW_REQUIRED" | "CONFLICT" | "UNAVAILABLE" | "RATE_LIMITED";
}>;
export type ApprovalFormControl = Readonly<{
  status: "READY"; intent: string; preparedAt: string; expiresAt: string;
}> | Readonly<{
  status: "POLICY_PENDING" | "REVIEW_REQUIRED" | "RECORDED"; intent: null;
}>;
