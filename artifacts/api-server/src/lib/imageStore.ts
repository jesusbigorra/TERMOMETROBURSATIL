import { pool } from "@workspace/db";

// Product photos live in Postgres (Neon) so the cash register does not depend on the Replit
// object-storage sidecar. The catalog is small and the browser shrinks each photo before
// uploading, so a bytea column is plenty. The table is created on demand, like the Telegram ones.
const IMAGE_DDL = `
CREATE TABLE IF NOT EXISTS product_images (
  id text PRIMARY KEY,
  content_type text NOT NULL,
  data bytea NOT NULL,
  size integer NOT NULL,
  owner text NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

let schemaReady: Promise<void> | null = null;
function ensureImageSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool.query(IMAGE_DDL).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/**
 * Stores an uploaded photo as private. Returns false when the id already belongs to a published
 * photo or to another user, so a finished image can never be overwritten.
 */
export async function saveImage(id: string, contentType: string, data: Buffer, owner: string): Promise<boolean> {
  await ensureImageSchema();
  // Uploads that were never finalized for a day are abandoned.
  await pool.query("DELETE FROM product_images WHERE is_public = false AND created_at < now() - interval '1 day'");
  const result = await pool.query(
    `INSERT INTO product_images (id, content_type, data, size, owner)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, size = EXCLUDED.size, created_at = now()
       WHERE product_images.is_public = false AND product_images.owner = EXCLUDED.owner`,
    [id, contentType, data, data.length, owner],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Publishes a photo the same user uploaded. Returns false when it does not exist or is not theirs. */
export async function publishImage(id: string, owner: string): Promise<boolean> {
  await ensureImageSchema();
  const result = await pool.query("UPDATE product_images SET is_public = true WHERE id = $1 AND owner = $2", [id, owner]);
  return (result.rowCount ?? 0) > 0;
}

/** Returns a published photo, or null. Photos that were never finalized are not served. */
export async function getPublicImage(id: string): Promise<{ contentType: string; data: Buffer } | null> {
  await ensureImageSchema();
  const result = await pool.query<{ content_type: string; data: Buffer }>(
    "SELECT content_type, data FROM product_images WHERE id = $1 AND is_public = true",
    [id],
  );
  const row = result.rows[0];
  return row ? { contentType: row.content_type, data: row.data } : null;
}
