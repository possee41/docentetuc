type SchemaDatabase = {
  prepare(sql: string): {
    bind(...values: string[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

const REQUIRED_AUTH_TABLES = ["user", "session", "account", "verification"] as const;
const REQUIRED_COMMUNITY_TABLES = [
  "community_rules_acceptances", "community_moderators", "community_posts", "community_comments",
  "community_reports", "community_blocks", "community_moderation_events", "community_rate_limits",
] as const;
const COMMUNITY_SAVED_POSTS_TABLE = "community_saved_posts";
const INSTALLATION_CREDENTIALS_TABLE = "installation_credentials";

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

/** Community stays disabled unless the complete additive Phase 3A schema exists. */
export async function hasCommunitySchema(database: SchemaDatabase) {
  try {
    const placeholders = REQUIRED_COMMUNITY_TABLES.map(() => "?").join(",");
    const result = await database.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`)
      .bind(...REQUIRED_COMMUNITY_TABLES)
      .first<{ count: number }>();
    return Number(result?.count) === REQUIRED_COMMUNITY_TABLES.length;
  } catch {
    return false;
  }
}

/** Saved-post routes stay disabled until the additive Phase 3B migration exists. */
export async function hasCommunitySavedPostsSchema(database: SchemaDatabase) {
  try {
    const result = await database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?")
      .bind(COMMUNITY_SAVED_POSTS_TABLE).first<{ count: number }>();
    return Number(result?.count) === 1;
  } catch {
    return false;
  }
}

/** New installations need a server-side hash before their possession cookie is trusted. */
export async function hasInstallationCredentialsSchema(database: SchemaDatabase) {
  try {
    const result = await database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?")
      .bind(INSTALLATION_CREDENTIALS_TABLE).first<{ count: number }>();
    return Number(result?.count) === 1;
  } catch {
    return false;
  }
}
