import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";
import {
  resolveAttachmentType,
  sniffAttachmentContent,
} from "../server/messages/fileTypes.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF_MIN = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
const TXT_OK = Buffer.from("hello groupflow\n", "utf8");
const HTML_FAKE = Buffer.from("<!DOCTYPE html><html><body>x</body></html>", "utf8");

async function twoMemberGroup(request, cookieJar, register) {
  const john = await register("John Files");
  const group = await request("/api/groups", {
    method: "POST",
    body: { name: "Attachment Lab" },
  });
  assert.equal(group.status, 201);
  const groupId = group.data.group.id;
  const invite = await request(`/api/groups/${groupId}/invitations`, {
    method: "POST",
    body: {},
  });
  const markJar = cookieJar();
  const mark = await register("Mark Files", { jar: markJar });
  await request("/api/groups/join", {
    method: "POST",
    body: { code: invite.data.invitation.code },
    jar: markJar,
  });
  return { groupId, johnId: john.user.id, markId: mark.user.id, markJar };
}

function fileForm(buffer, filename, type) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type }), filename);
  return form;
}

test("file type helpers accept allowed sniff signatures and reject HTML-as-txt", () => {
  const png = resolveAttachmentType({ filename: "dot.png", contentType: "image/png" });
  assert.equal(png.ok, true);
  assert.equal(sniffAttachmentContent(PNG_1X1, "image/png").ok, true);

  const htmlAsTxt = resolveAttachmentType({ filename: "note.txt", contentType: "text/plain" });
  assert.equal(htmlAsTxt.ok, true);
  assert.equal(sniffAttachmentContent(HTML_FAKE, "text/plain").ok, false);

  const exe = resolveAttachmentType({ filename: "malware.exe", contentType: "application/octet-stream" });
  assert.equal(exe.ok, false);
});

test("member can upload a staged attachment, send it with a caption, and peers can download", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId, markJar } = await twoMemberGroup(request, cookieJar, register);

    const uploaded = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(PNG_1X1, "pixel.png", "image/png"),
    });
    assert.equal(uploaded.status, 201, uploaded.data.error);
    assert.equal(uploaded.data.attachment.status, "staged");
    assert.equal(uploaded.data.attachment.fileName, "pixel.png");
    assert.equal(uploaded.data.attachment.isImage, true);
    const attachmentId = uploaded.data.attachment.id;

    const sent = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "See this pixel", attachmentId },
    });
    assert.equal(sent.status, 201, sent.data.error);
    assert.equal(sent.data.message.text, "See this pixel");
    assert.equal(sent.data.message.attachment.id, attachmentId);
    assert.equal(sent.data.message.attachment.status, "attached");

    const listed = await request(`/api/groups/${groupId}/messages`, { jar: markJar });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.messages.at(-1).attachment.fileName, "pixel.png");

    const download = await request(
      `/api/groups/${groupId}/attachments/${attachmentId}?disposition=inline`,
      { jar: markJar, raw: true },
    );
    assert.equal(download.status, 200);
    assert.equal(download.response.headers.get("content-type"), "image/png");
    assert.equal(download.response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(download.buffer, PNG_1X1);

    const reuse = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "reuse", attachmentId },
    });
    assert.equal(reuse.status, 400);
  });
});

test("attachment-only messages are allowed; blank messages without files are not", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId } = await twoMemberGroup(request, cookieJar, register);

    const blank = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "   " },
    });
    assert.equal(blank.status, 400);

    const uploaded = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(TXT_OK, "notes.txt", "text/plain"),
    });
    assert.equal(uploaded.status, 201);
    const sent = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "", attachmentId: uploaded.data.attachment.id },
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.message.text, "");
    assert.equal(sent.data.message.attachment.fileName, "notes.txt");
  });
});

test("disallowed content and oversized uploads are rejected", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId } = await twoMemberGroup(request, cookieJar, register);

    const html = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(HTML_FAKE, "page.txt", "text/plain"),
    });
    assert.equal(html.status, 400);

    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    const tooBig = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(huge, "big.txt", "text/plain"),
    });
    assert.equal(tooBig.status, 413);
  });
});

test("non-members cannot upload or download; non-uploader members cannot delete; coordinator can", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId, markJar } = await twoMemberGroup(request, cookieJar, register);

    // Coordinator (default jar) uploads and shares.
    const uploaded = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(PDF_MIN, "brief.pdf", "application/pdf"),
    });
    assert.equal(uploaded.status, 201);
    const attachmentId = uploaded.data.attachment.id;
    const sent = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "PDF", attachmentId },
    });
    assert.equal(sent.status, 201);

    const outsiderJar = cookieJar();
    await register("Outsider Files", { jar: outsiderJar });
    const deniedUpload = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(TXT_OK, "x.txt", "text/plain"),
      jar: outsiderJar,
    });
    assert.equal(deniedUpload.status, 403);

    const deniedDownload = await request(`/api/groups/${groupId}/attachments/${attachmentId}`, {
      jar: outsiderJar,
      raw: true,
    });
    assert.equal(deniedDownload.status, 403);

    // Ordinary member (Mark) did not upload — cannot delete.
    const memberDenied = await request(`/api/groups/${groupId}/attachments/${attachmentId}`, {
      method: "DELETE",
      jar: markJar,
    });
    assert.equal(memberDenied.status, 403);

    // Mark uploads a second file; coordinator can delete it.
    const markUpload = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(TXT_OK, "mark.txt", "text/plain"),
      jar: markJar,
    });
    assert.equal(markUpload.status, 201);
    const markAttachmentId = markUpload.data.attachment.id;
    await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "from mark", attachmentId: markAttachmentId },
      jar: markJar,
    });
    const deletedByCoordinator = await request(`/api/groups/${groupId}/attachments/${markAttachmentId}`, {
      method: "DELETE",
    });
    assert.equal(deletedByCoordinator.status, 200);

    const listed = await request(`/api/groups/${groupId}/messages`, { jar: markJar });
    assert.equal(listed.data.messages.at(-1).attachment.removed, true);

    const gone = await request(`/api/groups/${groupId}/attachments/${markAttachmentId}`, {
      jar: markJar,
      raw: true,
    });
    assert.equal(gone.status, 404);
  });
});

test("uploader can delete their own attached file", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId } = await twoMemberGroup(request, cookieJar, register);
    const uploaded = await request(`/api/groups/${groupId}/messages/attachments`, {
      method: "POST",
      formData: fileForm(PNG_1X1, "mine.png", "image/png"),
    });
    const attachmentId = uploaded.data.attachment.id;
    await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { attachmentId },
    });
    const deleted = await request(`/api/groups/${groupId}/attachments/${attachmentId}`, {
      method: "DELETE",
    });
    assert.equal(deleted.status, 200);
  });
});
