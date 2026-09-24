-- Operator-applied changes to the requested delivery date, from the published change and cancellation terms
-- (P1-02). One row per accepted request, so a resubmitted change cannot move the same order twice.
CREATE TABLE bloombox.order_delivery_date_changes (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL,
  request_id uuid NOT NULL,
  previous_date date NOT NULL,
  next_date date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 200),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (operator_id, request_id),
  CHECK (previous_date <> next_date)
);

CREATE INDEX order_delivery_date_changes_order_idx
  ON bloombox.order_delivery_date_changes (order_id, occurred_at DESC, id);
