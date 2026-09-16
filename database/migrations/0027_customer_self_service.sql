-- Customer-owned preferences, address book and favourites. All personal fields are authenticated ciphertext.
CREATE TABLE bloombox.customer_portals (
 customer_id uuid PRIMARY KEY REFERENCES bloombox.customer_accounts(id),
 revision bigint NOT NULL CHECK (revision > 0),
 key_id text NOT NULL,
 ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) <= 65536),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE bloombox.customer_requests (
 id uuid PRIMARY KEY,
 customer_id uuid NOT NULL REFERENCES bloombox.customer_accounts(id),
 order_id uuid REFERENCES bloombox.orders(id),
 kind text NOT NULL CHECK (kind IN ('ORDER','CANCELLATION','RETURN','DELIVERY','OTHER')),
 status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REPLIED','CLOSED')),
 key_id text NOT NULL,
 ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) <= 16384),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX customer_requests_owner_idx ON bloombox.customer_requests(customer_id, created_at DESC, id DESC);
CREATE INDEX customer_requests_queue_idx ON bloombox.customer_requests(status, updated_at, id);
CREATE TABLE bloombox.customer_request_changes (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES bloombox.customer_requests(id),
 operator_id uuid NOT NULL,
 revision bigint NOT NULL,
 status text NOT NULL CHECK (status IN ('REPLIED','CLOSED')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(request_id, revision)
);
