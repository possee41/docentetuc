type SchemaDatabase = {
  prepare(sql: string): {
    bind(...values: string[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

const REQUIRED_AUTH_TABLES = ["user", "session", "account", "verification"] as const;

/** Keeps account sign-in disabled until the additive D1 migration exists. */
export async function hasAuthSchema(database: SchemaDatabase) {
  try {
    const result = await database
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?)")
      .bind(...REQUIRED_AUTH_TABLES)
      .first<{ count: number }>();
    return Number(result?.count) === REQUIRED_AUTH_TABLES.length;
  } catch {
    return false;
  }
}

/** Account data operations stay disabled until the explicit ownership table exists. */
export async function hasAccountIdentitySchema(database: SchemaDatabase) {
  try {
    const result = await database
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='account_installations'")
      .bind()
      .first<{ count: number }>();
    return Number(result?.count) === 1;
  } catch {
    return false;
  }
}
