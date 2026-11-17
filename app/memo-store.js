export function createMemoStore(pool) {
  return {
    async list(ownerId) {
      const result = await pool.query(
        `SELECT id, title, content, created_at, updated_at
         FROM public.memos
         WHERE owner_id = $1
         ORDER BY updated_at DESC
         LIMIT 100`,
        [ownerId],
      );

      return result.rows.map(toMemo);
    },

    async create(ownerId, memo) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await pool.query(
        `INSERT INTO public.memos (owner_id, id, title, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [ownerId, id, memo.title, memo.content, now],
      );

      return { id, ...memo, createdAt: now, updatedAt: now };
    },

    async update(ownerId, id, memo) {
      const now = new Date().toISOString();
      const result = await pool.query(
        `UPDATE public.memos
         SET title = $3, content = $4, updated_at = $5
         WHERE owner_id = $1 AND id = $2`,
        [ownerId, id, memo.title, memo.content, now],
      );

      if (result.rowCount === 0) {
        return null;
      }

      const created = await pool.query(
        "SELECT created_at FROM public.memos WHERE owner_id = $1 AND id = $2",
        [ownerId, id],
      );
      if (created.rows.length === 0) {
        return null;
      }

      return {
        id,
        ...memo,
        createdAt: created.rows[0].created_at instanceof Date
          ? created.rows[0].created_at.toISOString()
          : created.rows[0].created_at,
        updatedAt: now,
      };
    },

    async delete(ownerId, id) {
      const result = await pool.query(
        "DELETE FROM public.memos WHERE owner_id = $1 AND id = $2",
        [ownerId, id],
      );
      return result.rowCount > 0;
    },
  };
}

function toMemo(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}
