CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skus (
  sku text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('laptop', 'console', 'phone')),
  condition text NOT NULL CHECK (condition IN ('new', 'uk_used', 'refurbished')),
  variant text NOT NULL,
  price_kobo bigint NOT NULL CHECK (price_kobo > 0),
  qty_available integer NOT NULL CHECK (qty_available >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quotes (
  token text PRIMARY KEY,
  sku text NOT NULL REFERENCES skus(sku),
  price_kobo bigint NOT NULL CHECK (price_kobo > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  reference text PRIMARY KEY,
  sku text NOT NULL REFERENCES skus(sku),
  quote_token text REFERENCES quotes(token),
  customer_phone text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  amount_expected_kobo bigint NOT NULL CHECK (amount_expected_kobo > 0),
  amount_paid_kobo bigint,
  currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL CHECK (status IN (
    'INITIALIZING', 'PENDING', 'PAID', 'UNDERPAID', 'EXPIRED', 'FAILED', 'PAID_NEEDS_OWNER'
  )),
  payment_expires_at timestamptz NOT NULL,
  authorization_url text,
  paystack_access_code text,
  verify_attempts integer NOT NULL DEFAULT 0 CHECK (verify_attempts >= 0),
  initialize_attempts integer NOT NULL DEFAULT 0 CHECK (initialize_attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  last_verified_at timestamptz
);

CREATE INDEX orders_customer_sku_idx ON orders(customer_phone, sku, created_at DESC);
CREATE INDEX orders_expiry_idx ON orders(payment_expires_at)
  WHERE status IN ('INITIALIZING', 'PENDING');

CREATE TABLE payment_events (
  id bigserial PRIMARY KEY,
  order_reference text NOT NULL REFERENCES orders(reference),
  event_type text NOT NULL,
  provider_status integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_events_reference_idx ON payment_events(order_reference, created_at);

CREATE TABLE owner_alerts (
  id bigserial PRIMARY KEY,
  order_reference text NOT NULL REFERENCES orders(reference),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged boolean NOT NULL DEFAULT false
);
