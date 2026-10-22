import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validateTaskPayload } from "./validation.js";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from "./service.js";

function sendError(res, error) {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  const payload = { error: error.message || "Internal server error" };
  if (error.fields) payload.fields = error.fields;
  return res.status(status).json(payload);
}

export function createTasksRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    try {
      const tasks = await listTasks(req.db, req.params.groupId, req.user._id);
      return res.json({ tasks });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/", async (req, res) => {
    try {
      const parsed = validateTaskPayload(req.body ?? {}, "create");
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const task = await createTask(req.db, req.params.groupId, req.user, parsed.value);
      return res.status(201).json({ task });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:taskId", async (req, res) => {
    try {
      const task = await getTask(req.db, req.params.groupId, req.params.taskId, req.user._id);
      return res.json({ task });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.patch("/:taskId", async (req, res) => {
    try {
      const parsed = validateTaskPayload(req.body ?? {}, "update");
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const task = await updateTask(
        req.db,
        req.params.groupId,
        req.params.taskId,
        req.user,
        parsed.value,
      );
      return res.json({ task });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete("/:taskId", async (req, res) => {
    try {
      await deleteTask(req.db, req.params.groupId, req.params.taskId, req.user);
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}
