import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb, startDbReconnect, stopDbReconnect } from "./db.js";
import { ensureAuthIndexes } from "./auth/sessions.js";
import { ensureGroupIndexes } from "./groups/service.js";
import { ensureTaskIndexes } from "./tasks/service.js";
import { ensureMessageIndexes } from "./messages/service.js";
import { ensureReadPositionIndexes } from "./messages/readPosition.js";
import { ensureEventIndexes } from "./events/service.js";
import { ensureActivityIndexes } from "./activity/service.js";

async function ensureAllIndexes(db) {
  await ensureAuthIndexes(db);
  await ensureGroupIndexes(db);
  await ensureTaskIndexes(db);
  await ensureMessageIndexes(db);
  await ensureReadPositionIndexes(db);
  await ensureEventIndexes(db);
  await ensureActivityIndexes(db);
}

async function start() {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`GroupFlow listening on http://localhost:${config.port}`);
    console.log(`Health: http://localhost:${config.port}/api/health`);
  });

  // Controlled reconnect: first attempt immediately, then capped backoff.
  // Express stays up; DB-dependent routes return 503 until indexes are ready.
  startDbReconnect({
    uri: config.mongodbUri,
    ensureIndexes: ensureAllIndexes,
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down…`);
    stopDbReconnect();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

start();
