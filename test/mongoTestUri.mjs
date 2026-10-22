/**
 * Database-free validation of MongoDB URIs used by integration tests.
 * Never connects and never deletes. Import this from tests that must not touch MongoDB.
 */

/** Default application database name used by server/config.js when unset. */
export const APPLICATION_DATABASE_NAMES = Object.freeze(["groupflow"]);

/** MongoDB reserved / system database names that must never be wiped by tests. */
export const FORBIDDEN_SYSTEM_DATABASE_NAMES = Object.freeze(["admin", "local", "config"]);

/**
 * @param {string} uri
 * @returns {{
 *   uri: string,
 *   database: string,
 *   host: string,
 *   port: string | null,
 *   isSrv: boolean,
 *   normalizedTarget: string,
 * }}
 */
export function parseMongoUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) {
    const error = new Error("MongoDB URI is missing or empty.");
    error.code = "MONGO_URI_MISSING";
    throw error;
  }
  const trimmed = uri.trim();
  const isSrv = trimmed.startsWith("mongodb+srv://");
  const isStandard = trimmed.startsWith("mongodb://");
  if (!isSrv && !isStandard) {
    const error = new Error("MongoDB URI must start with mongodb:// or mongodb+srv://.");
    error.code = "MONGO_URI_SCHEME";
    throw error;
  }

  let url;
  try {
    const rewritten = trimmed
      .replace(/^mongodb\+srv:/i, "https:")
      .replace(/^mongodb:/i, "http:");
    url = new URL(rewritten);
  } catch {
    const error = new Error("MongoDB URI could not be parsed.");
    error.code = "MONGO_URI_PARSE";
    throw error;
  }

  const pathDb = decodeURIComponent((url.pathname || "").replace(/^\//, "").split("/")[0] || "");
  const database = pathDb.trim();
  const host = String(url.hostname || "").toLowerCase();
  if (!host) {
    const error = new Error("MongoDB URI is missing a host.");
    error.code = "MONGO_URI_HOST";
    throw error;
  }

  const port = url.port ? url.port : (isSrv ? null : "27017");
  const normalizedTarget = isSrv
    ? `${host}/${database}`
    : `${host}:${port || "27017"}/${database}`;

  return {
    uri: trimmed,
    database,
    host,
    port,
    isSrv,
    normalizedTarget,
  };
}

function isClearlyNamedTestDatabase(database) {
  // e.g. groupflow_test, groupflow_auth_test — must end with _test
  return /_test$/i.test(database);
}

/**
 * Validate a dedicated test MongoDB URI before any connection or cleanup.
 *
 * @param {unknown} testUri value of MONGODB_URI_TEST
 * @param {{ appUri?: string | null }} [options] optional app URI for target comparison
 */
export function assertSafeTestMongoUri(testUri, { appUri = null } = {}) {
  if (testUri === undefined || testUri === null || String(testUri).trim() === "") {
    const error = new Error(
      "MONGODB_URI_TEST is required and must point to a dedicated test database (for example mongodb://127.0.0.1:27017/groupflow_test). Refusing to fall back to MONGODB_URI or the application database.",
    );
    error.code = "MONGO_TEST_URI_REQUIRED";
    throw error;
  }

  const parsed = parseMongoUri(String(testUri));

  if (!parsed.database) {
    const error = new Error(
      "MONGODB_URI_TEST must include an explicit database name (for example …/groupflow_test).",
    );
    error.code = "MONGO_TEST_DB_MISSING";
    throw error;
  }

  const dbLower = parsed.database.toLowerCase();

  if (FORBIDDEN_SYSTEM_DATABASE_NAMES.includes(dbLower)) {
    const error = new Error(
      `MONGODB_URI_TEST must not target the system database "${parsed.database}".`,
    );
    error.code = "MONGO_TEST_DB_SYSTEM";
    throw error;
  }

  if (APPLICATION_DATABASE_NAMES.includes(dbLower)) {
    const error = new Error(
      `MONGODB_URI_TEST must not target the application database "${parsed.database}". Use a dedicated name such as groupflow_test.`,
    );
    error.code = "MONGO_TEST_DB_APPLICATION";
    throw error;
  }

  if (!isClearlyNamedTestDatabase(parsed.database)) {
    const error = new Error(
      `MONGODB_URI_TEST database name "${parsed.database}" must be clearly a test database (end with _test, for example groupflow_test).`,
    );
    error.code = "MONGO_TEST_DB_NAME";
    throw error;
  }

  if (appUri !== undefined && appUri !== null && String(appUri).trim() !== "") {
    let appParsed;
    try {
      appParsed = parseMongoUri(String(appUri));
    } catch {
      appParsed = null;
    }
    if (appParsed?.database && parsed.normalizedTarget === appParsed.normalizedTarget) {
      const error = new Error(
        "MONGODB_URI_TEST resolves to the same normalized database target as MONGODB_URI. Tests refuse to use the application database.",
      );
      error.code = "MONGO_TEST_DB_SAME_AS_APP";
      throw error;
    }
  }

  return parsed;
}
