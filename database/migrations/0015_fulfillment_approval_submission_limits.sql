-- Operational allowance only; does not authorize approval or dispatch.
-- One bounded row per mapped operator, shared across sessions, shops and runtime modes.
CREATE TABLE bloombox.fulfillment_approval_submission_limits (
  operator_id UUID PRIMARY KEY,
  attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT approval_submission_attempts_bounded CHECK (
    jsonb_typeof(attempts) = 'array' AND jsonb_array_length(attempts) <= 10
  )
);
