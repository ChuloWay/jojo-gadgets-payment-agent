CREATE TABLE order_fulfillments (
  order_reference text PRIMARY KEY REFERENCES orders(reference) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('pickup', 'delivery_request')),
  preferred_time text,
  delivery_area text,
  landmark text,
  recipient_name text,
  contact_phone text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_OWNER_CONFIRMATION'
    CHECK (status IN ('PENDING_OWNER_CONFIRMATION', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (method = 'pickup' AND preferred_time IS NOT NULL AND delivery_area IS NULL)
    OR
    (method = 'delivery_request' AND delivery_area IS NOT NULL AND recipient_name IS NOT NULL)
  )
);

