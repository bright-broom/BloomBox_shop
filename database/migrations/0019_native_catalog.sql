-- Catalog owns merchandising and prices. Availability is not an inventory reservation.
-- No preview products, prices or stock assumptions are copied into production.
CREATE TABLE bloombox.catalog_products (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (length(slug) <= 120 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  available boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  subtitle text NOT NULL CHECK (length(btrim(subtitle)) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  currency text NOT NULL DEFAULT 'JPY' CHECK (currency = 'JPY'),
  price_minor bigint NOT NULL CHECK (price_minor BETWEEN 0 AND 9007199254740991),
  image_url text NOT NULL CHECK (length(image_url) BETWEEN 1 AND 2048),
  image_alt text NOT NULL CHECK (length(btrim(image_alt)) BETWEEN 1 AND 200),
  palette text NOT NULL CHECK (length(btrim(palette)) BETWEEN 1 AND 100),
  occasions text[] NOT NULL CHECK (cardinality(occasions) BETWEEN 1 AND 20 AND array_position(occasions, NULL) IS NULL),
  flowers text[] NOT NULL CHECK (cardinality(flowers) BETWEEN 1 AND 20 AND array_position(flowers, NULL) IS NULL),
  grower text NOT NULL CHECK (length(btrim(grower)) BETWEEN 1 AND 120),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT available OR status = 'PUBLISHED')
);

CREATE INDEX catalog_products_public_idx ON bloombox.catalog_products (slug, id)
  WHERE status = 'PUBLISHED';
