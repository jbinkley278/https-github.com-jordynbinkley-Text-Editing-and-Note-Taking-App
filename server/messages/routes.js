import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { countUnreadMessages, markMessagesRead } from "./readPosition.js";
import { validateMessagePayload } from "./validation.js";
import { createMessage, listMessages } from "./service.js";

function sendError(res, error) {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  const payload = { error: error.message || "Internal server error" };
  if (error.fields) payload.fields = error.fields;
  return res.status(status).json(payload);
}

export function createMessagesRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get("/unread", async (req, res) => {
    try {
      const result = await countUnreadMessages(req.db, req.params.groupId, req.user._id);
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/read", async (req, res) => {
    try {
      const upToMessageId = String(req.body?.upToMessageId ?? "").trim();
      if (!upToMessageId) {
        return res.status(400).json({ error: "upToMessageId is required." });
      }
      const result = await markMessagesRead(
        req.db,
        req.params.groupId,
        req.user._id,
        upToMessageId,
      );
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/", async (req, res) => {
    try {
      const messages = await listMessages(req.db, req.params.groupId, req.user._id);
      return res.json({ messages });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/", async (req, res) => {
    try {
      const parsed = validateMessagePayload(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const message = await createMessage(req.db, req.params.groupId, req.user, parsed.value);
      return res.status(201).json({ message });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}
