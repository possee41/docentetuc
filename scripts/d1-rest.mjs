// D1 REST transport for an external Node runner. No Worker executes the SQL.
// The caller must provide a token scoped to exactly one D1 database.
export function createD1Rest({ accountId, databaseId, token, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || "") ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId || "") ||
      typeof token !== "string" || token.length < 20) throw new Error("D1_CONFIGURATION_INVALID");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const metrics = { requests: 0, rowsRead: 0, rowsWritten: 0 };

  async function query(sql, params) {
    if (typeof sql !== "string" || !sql.trim() || !Array.isArray(params) ||
        params.some((value) => value !== null && typeof value !== "string" &&
          !(typeof value === "number" && Number.isFinite(value)))) throw new Error("D1_QUERY_INVALID");
    // The REST API documents string parameters only. JSON wrappers preserve
    // SQLite NULL and numeric types without interpolating untrusted values.
    if ((sql.match(/\?/g) || []).length !== params.length) throw new Error("D1_QUERY_INVALID");
    const body = { sql: sql.replaceAll("?", () => "json_extract(?,'$')"), params: params.map((value) => JSON.stringify(value)) };
    metrics.requests++;
    let response;
    try {
      response = await fetcher(url, { method: "POST", headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch { throw new Error("D1_NETWORK_ERROR"); }
    if (!response.ok) throw new Error(`D1_HTTP_${response.status}`);
    let envelope;
    try { envelope = await response.json(); } catch { throw new Error("D1_RESPONSE_INVALID"); }
    const result = envelope?.result;
    if (envelope?.success !== true || !Array.isArray(result) || result.length !== 1 || result[0]?.success !== true ||
        (result[0].results !== undefined && !Array.isArray(result[0].results)) ||
        (/^\s*SELECT\b/i.test(sql) && !Array.isArray(result[0].results))) throw new Error("D1_QUERY_FAILED");
    metrics.rowsRead += Number(result[0].meta?.rows_read || 0);
    metrics.rowsWritten += Number(result[0].meta?.rows_written || 0);
    return { ...result[0], results: result[0].results || [] };
  }

  const prepare = (sql) => ({ bind: (...params) => ({
    all: () => query(sql, params),
    first: async () => (await query(sql, params)).results[0] || null,
    run: () => query(sql, params),
  }) });
  return { prepare,
    // REST does not document a transaction guarantee for its batch endpoint.
    // Importers use one publication per step; replay is safe after a partial failure.
    batch: async (statements) => {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
    metrics: () => ({ ...metrics }),
  };
}
