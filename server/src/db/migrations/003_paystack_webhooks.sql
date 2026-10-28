CREATE TABLE paystack_webhook_events (
  event_key text PRIMARY KEY,
  event_type text NOT NULL,
  provider_transaction_id text NOT NULL,
  order_reference text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED')),
  result_status text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX paystack_webhook_events_pending_idx
  ON paystack_webhook_events(next_attempt_at, received_at)
  WHERE status IN ('RECEIVED', 'FAILED', 'PROCESSING');
