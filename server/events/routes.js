import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validateEventPayload } from "./validation.js";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  updateEvent,
} from "./service.js";

function sendError(res, error) {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  const payload = { error: error.message || "Internal server error" };
  if (error.fields) payload.fields = error.fields;
  return res.status(status).json(payload);
}

export function createEventsRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    try {
      const events = await listEvents(req.db, req.params.groupId, req.user._id);
      return res.json({ events });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/", async (req, res) => {
    try {
      const parsed = validateEventPayload(req.body ?? {}, "create");
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const event = await createEvent(req.db, req.params.groupId, req.user, parsed.value);
      return res.status(201).json({ event });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:eventId", async (req, res) => {
    try {
      const event = await getEvent(req.db, req.params.groupId, req.params.eventId, req.user._id);
      return res.json({ event });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.patch("/:eventId", async (req, res) => {
    try {
      const parsed = validateEventPayload(req.body ?? {}, "update");
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const event = await updateEvent(
        req.db,
        req.params.groupId,
        req.params.eventId,
        req.user,
        parsed.value,
      );
      return res.json({ event });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete("/:eventId", async (req, res) => {
    try {
      await deleteEvent(req.db, req.params.groupId, req.params.eventId, req.user);
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}
