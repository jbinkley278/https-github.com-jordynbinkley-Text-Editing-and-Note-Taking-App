import Busboy from "busboy";
import { ATTACHMENT_MAX_BYTES } from "./fileTypes.js";

/**
 * Parse a single multipart file field named `file` (optional text fields ignored for upload).
 * Buffers the file in memory up to ATTACHMENT_MAX_BYTES (10 MB product limit).
 *
 * @param {import("express").Request} req
 * @returns {Promise<{ file: { buffer: Buffer, filename: string, mimeType: string } | null, fields: Record<string, string> }>}
 */
export function parseMultipartFile(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"];
    if (!contentType || !String(contentType).toLowerCase().includes("multipart/form-data")) {
      const error = new Error("Upload must use multipart/form-data with a file field named \"file\".");
      error.status = 400;
      reject(error);
      return;
    }

    let settled = false;
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    let filename = "";
    let mimeType = "";
    let sawFile = false;
    let tooLarge = false;
    /** @type {Record<string, string>} */
    const fields = {};

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: ATTACHMENT_MAX_BYTES,
        fields: 10,
        fieldSize: 8 * 1024,
      },
    });

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    busboy.on("file", (fieldname, stream, info) => {
      if (fieldname !== "file") {
        stream.resume();
        return;
      }
      sawFile = true;
      filename = info.filename || "attachment";
      mimeType = info.mimeType || "application/octet-stream";
      stream.on("data", (chunk) => {
        total += chunk.length;
        if (total > ATTACHMENT_MAX_BYTES) {
          tooLarge = true;
          stream.resume();
          return;
        }
        chunks.push(chunk);
      });
      stream.on("limit", () => {
        tooLarge = true;
      });
      stream.on("error", fail);
    });

    busboy.on("field", (name, value) => {
      fields[name] = String(value ?? "");
    });

    busboy.on("error", fail);
    busboy.on("finish", () => {
      if (tooLarge) {
        const error = new Error(`Attachment must be ${ATTACHMENT_MAX_BYTES} bytes or smaller (10 MB).`);
        error.status = 413;
        fail(error);
        return;
      }
      if (!sawFile) {
        done({ file: null, fields });
        return;
      }
      done({
        file: {
          buffer: Buffer.concat(chunks, total),
          filename,
          mimeType,
        },
        fields,
      });
    });

    req.pipe(busboy);
  });
}
