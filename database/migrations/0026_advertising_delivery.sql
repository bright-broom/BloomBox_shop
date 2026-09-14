-- Advertising owns consent and delivery only. No commerce table is mutated.
CREATE TABLE bloombox.advertising_consents (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  policy_version text NOT NULL,
  key_id text NOT NULL,
  attribution_ciphertext bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE bloombox.advertising_deliveries (
  id uuid PRIMARY KEY,
  purchase_intent_id uuid NOT NULL REFERENCES bloombox.purchase_intents(id),
  consent_id uuid NOT NULL REFERENCES bloombox.advertising_consents(id),
  provider text NOT NULL CHECK (provider IN ('google', 'meta', 'webhook')),
  destination text NOT NULL,
  event jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'accepted', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  lease uuid,
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '47 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  receipt text,
  UNIQUE (purchase_intent_id, provider)
);
CREATE INDEX advertising_due ON bloombox.advertising_deliveries(available_at) WHERE status IN ('pending', 'sending');
CREATE INDEX advertising_consent_expiry ON bloombox.advertising_consents(expires_at);
