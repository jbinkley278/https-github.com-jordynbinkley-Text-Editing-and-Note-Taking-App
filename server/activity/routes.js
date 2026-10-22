import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { activitySummary, listActivity } from "./service.js";

function sendError(res, error) {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  const payload = { error: error.message || "Internal server error" };
  if (error.fields) payload.fields = error.fields;
  return res.status(status).json(payload);
}

export function createActivityRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    try {
      const limit = req.query.limit;
      const actorId = typeof req.query.actorId === "string" ? req.query.actorId : null;
      const activity = await listActivity(req.db, req.params.groupId, req.user._id, {
        limit,
        actorId,
      });
      return res.json({ activity });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/summary", async (req, res) => {
    try {
      const summary = await activitySummary(req.db, req.params.groupId, req.user._id);
      return res.json({ summary });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Activity is generated server-side after successful mutations only.
  router.post(["/", "/*"], (_req, res) => {
    return res.status(405).json({ error: "Activity is recorded server-side only." });
  });
  router.put(["/", "/*"], (_req, res) => {
    return res.status(405).json({ error: "Activity is recorded server-side only." });
  });
  router.patch(["/", "/*"], (_req, res) => {
    return res.status(405).json({ error: "Activity is recorded server-side only." });
  });
  router.delete(["/", "/*"], (_req, res) => {
    return res.status(405).json({ error: "Activity is recorded server-side only." });
  });

  return router;
}
