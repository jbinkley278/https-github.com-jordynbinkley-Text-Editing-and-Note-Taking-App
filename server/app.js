import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDbHealth } from "./db.js";
import { createAuthRouter } from "./auth/routes.js";
import { createActivityRouter } from "./activity/routes.js";
import { createGroupsRouter } from "./groups/routes.js";
import { createTasksRouter } from "./tasks/routes.js";
import { createMessagesRouter } from "./messages/routes.js";
import { createEventsRouter } from "./events/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  /**
   * Distinguishes process health from MongoDB readiness.
   * - 200: Express is up (database may still be unavailable → status "degraded")
   * - database "connected" only after connect + required index setup succeed
   * - databaseRetrying true only while a prepare attempt is in flight or a backoff timer is scheduled
   */
  app.get("/api/health", async (_req, res) => {
    const db = await checkDbHealth();
    const payload = {
      status: db.ready ? "ok" : "degraded",
      server: "ok",
      database: db.ready ? "connected" : "disconnected",
      databaseReady: db.ready,
      databaseRetrying: Boolean(db.retrying),
      ...(db.ready ? {} : { databaseError: db.error }),
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(payload);
  });

  app.get("/api", (_req, res) => {
    res.json({
      name: "GroupFlow API",
      version: "0.1.0",
      note: "Auth, groups, tasks, chat, calendar meetings, and contribution activity are persisted in MongoDB. Task due dates appear on the calendar from the tasks collection (not duplicated as events).",
    });
  });

  app.use("/api/auth", createAuthRouter());
  app.use("/api/groups/:groupId/tasks", createTasksRouter());
  app.use("/api/groups/:groupId/messages", createMessagesRouter());
  app.use("/api/groups/:groupId/events", createEventsRouter());
  app.use("/api/groups/:groupId/activity", createActivityRouter());
  app.use("/api/groups", createGroupsRouter());

  // Public frontend only — never serve the repo root (server/, test/, package.json, .env, docs, etc.).
  app.get(["/", "/index.html"], (_req, res) => {
    res.sendFile(path.join(rootDir, "index.html"));
  });

  app.use(
    "/src",
    express.static(path.join(rootDir, "src"), {
      fallthrough: false,
      index: false,
      dotfiles: "deny",
    }),
  );

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
