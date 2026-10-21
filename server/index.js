import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb, connectDb, getDb } from "./db.js";
import { ensureAuthIndexes } from "./auth/sessions.js";
import { ensureGroupIndexes } from "./groups/service.js";
import { ensureTaskIndexes } from "./tasks/service.js";
import { ensureMessageIndexes } from "./messages/service.js";
import { ensureReadPositionIndexes } from "./messages/readPosition.js";
import { ensureEventIndexes } from "./events/service.js";
import { ensureActivityIndexes } from "./activity/service.js";

async function start() {
  let dbReady = false;
  try {
    await connectDb();
    const db = getDb();
    await ensureAuthIndexes(db);
    await ensureGroupIndexes(db);
    await ensureTaskIndexes(db);
    await ensureMessageIndexes(db);
    await ensureReadPositionIndexes(db);
    await ensureEventIndexes(db);
    await ensureActivityIndexes(db);
    dbReady = true;
    console.log(`MongoDB connected (${config.mongodbUri})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`MongoDB unavailable at startup: ${message}`);
    console.warn("Server will stay up. GET /api/health reports database: disconnected.");
    console.warn("Auth, group, task, chat, calendar, and activity routes require MongoDB.");
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`GroupFlow listening on http://localhost:${config.port}`);
    console.log(`Health: http://localhost:${config.port}/api/health`);
    console.log(`Database at start: ${dbReady ? "connected" : "disconnected"}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down…`);
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();
