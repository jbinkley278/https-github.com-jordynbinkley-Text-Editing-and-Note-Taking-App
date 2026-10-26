import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { deleteAttachment, openAttachmentDownload } from "./attachments.js";

function sendError(res, error) {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  const payload = { error: error.message || "Internal server error" };
  if (error.fields) payload.fields = error.fields;
  return res.status(status).json(payload);
}

function contentDisposition(fileName, { inline = false } = {}) {
  const safe = String(fileName ?? "attachment").replace(/["\\]/g, "_");
  const type = inline ? "inline" : "attachment";
  return `${type}; filename="${safe}"`;
}

export function createAttachmentRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  router.get("/:attachmentId", async (req, res) => {
    try {
      const { doc, stream } = await openAttachmentDownload(
        req.db,
        req.params.groupId,
        req.params.attachmentId,
        req.user._id,
      );
      const inline = String(req.query.disposition ?? "") === "inline"
        && String(doc.contentType).startsWith("image/");

      res.setHeader("Content-Type", doc.contentType);
      res.setHeader("Content-Length", String(doc.size));
      res.setHeader("Content-Disposition", contentDisposition(doc.originalName, { inline }));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");

      stream.on("error", (error) => {
        console.error(error);
        if (!res.headersSent) {
          res.status(500).json({ error: "Could not download the attachment." });
        } else {
          res.destroy(error);
        }
      });
      stream.pipe(res);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete("/:attachmentId", async (req, res) => {
    try {
      const result = await deleteAttachment(
        req.db,
        req.params.groupId,
        req.params.attachmentId,
        req.user,
      );
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}
