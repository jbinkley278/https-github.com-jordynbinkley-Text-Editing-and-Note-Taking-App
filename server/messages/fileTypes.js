import path from "node:path";

/** Product limits for chat attachments (not malware scanning). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_FILENAME = 180;

/**
 * Allowed MIME types + extensions. SVG/HTML/executable types are rejected.
 * @type {Record<string, { extensions: string[], sniff: (buf: Buffer) => boolean }>}
 */
export const ALLOWED_ATTACHMENT_TYPES = {
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    sniff: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  "image/png": {
    extensions: [".png"],
    sniff: (buf) =>
      buf.length >= 8
      && buf[0] === 0x89
      && buf[1] === 0x50
      && buf[2] === 0x4e
      && buf[3] === 0x47
      && buf[4] === 0x0d
      && buf[5] === 0x0a
      && buf[6] === 0x1a
      && buf[7] === 0x0a,
  },
  "image/webp": {
    extensions: [".webp"],
    sniff: (buf) =>
      buf.length >= 12
      && buf.toString("ascii", 0, 4) === "RIFF"
      && buf.toString("ascii", 8, 12) === "WEBP",
  },
  "application/pdf": {
    extensions: [".pdf"],
    sniff: (buf) => buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-",
  },
  "text/plain": {
    extensions: [".txt"],
    sniff: (buf) => {
      if (!buf.length) return true;
      if (buf.includes(0x00)) return false;
      const head = buf.toString("utf8", 0, Math.min(buf.length, 256)).trimStart().toLowerCase();
      if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<svg")) {
        return false;
      }
      return true;
    },
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extensions: [".docx"],
    sniff: isZipContainer,
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extensions: [".xlsx"],
    sniff: isZipContainer,
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    extensions: [".pptx"],
    sniff: isZipContainer,
  },
};

const EXT_TO_MIME = new Map();
for (const [mime, meta] of Object.entries(ALLOWED_ATTACHMENT_TYPES)) {
  for (const ext of meta.extensions) EXT_TO_MIME.set(ext, mime);
}

function isZipContainer(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
    && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
    && (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08);
}

export function sanitizeAttachmentFilename(name) {
  const base = path.basename(String(name ?? "").replace(/\\/g, "/")).trim();
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, ATTACHMENT_MAX_FILENAME);
  return cleaned || "attachment";
}

export function extensionOf(filename) {
  const base = sanitizeAttachmentFilename(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/**
 * Resolve declared content-type against extension; prefer extension mapping when both known.
 * @returns {{ ok: true, contentType: string, filename: string } | { ok: false, error: string }}
 */
export function resolveAttachmentType({ filename, contentType }) {
  const safeName = sanitizeAttachmentFilename(filename);
  const ext = extensionOf(safeName);
  const declared = String(contentType ?? "").split(";")[0].trim().toLowerCase();

  const fromExt = EXT_TO_MIME.get(ext) ?? null;
  if (!fromExt) {
    return {
      ok: false,
      error: "File type is not allowed. Use JPEG, PNG, WebP, PDF, TXT, DOCX, XLSX, or PPTX.",
    };
  }

  if (declared && declared !== "application/octet-stream" && declared !== fromExt) {
    // Some browsers send generic types; only reject when a conflicting specific type is declared.
    if (ALLOWED_ATTACHMENT_TYPES[declared] && declared !== fromExt) {
      return { ok: false, error: "File extension does not match the declared content type." };
    }
  }

  return { ok: true, contentType: fromExt, filename: safeName };
}

/**
 * @param {Buffer} head
 * @param {string} contentType
 */
export function sniffAttachmentContent(head, contentType) {
  const meta = ALLOWED_ATTACHMENT_TYPES[contentType];
  if (!meta) return { ok: false, error: "File type is not allowed." };
  if (!meta.sniff(head)) {
    return { ok: false, error: "File contents do not match the allowed type." };
  }
  return { ok: true };
}

export function isImageContentType(contentType) {
  return String(contentType ?? "").startsWith("image/");
}
