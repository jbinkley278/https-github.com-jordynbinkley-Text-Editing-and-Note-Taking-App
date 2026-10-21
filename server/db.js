import { MongoClient } from "mongodb";
import { config } from "./config.js";

/** @type {MongoClient | null} */
let client = null;
let connected = false;
/** @type {string | null} */
let lastError = null;

export function getDbStatus() {
  return {
    connected,
    error: connected ? null : lastError ?? "Database not connected",
  };
}

/** Live check used by /api/health. */
export async function checkDbHealth() {
  if (!client) {
    return getDbStatus();
  }
  try {
    await client.db().command({ ping: 1 });
    connected = true;
    lastError = null;
  } catch (error) {
    connected = false;
    lastError = error instanceof Error ? error.message : String(error);
  }
  return getDbStatus();
}

export async function connectDb(uri = config.mongodbUri) {
  if (client && connected) {
    try {
      await client.db().command({ ping: 1 });
      return client.db();
    } catch {
      // fall through and reconnect
    }
  }

  if (client) {
    try {
      await client.close();
    } catch {
      // ignore close errors during reconnect
    }
    client = null;
    connected = false;
  }

  try {
    const next = new MongoClient(uri, {
      serverSelectionTimeoutMS: 3000,
    });
    await next.connect();
    await next.db().command({ ping: 1 });
    client = next;
    connected = true;
    lastError = null;
    return client.db();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    client = null;
    connected = false;
    throw error;
  }
}

export async function closeDb() {
  if (!client) return;
  await client.close();
  client = null;
  connected = false;
}

/** Returns the database when connected; otherwise null. */
export function getDb() {
  if (!client || !connected) return null;
  return client.db();
}
