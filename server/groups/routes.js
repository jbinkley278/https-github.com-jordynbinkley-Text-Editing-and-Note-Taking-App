import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validateGroupCreate, validateInviteCode } from "./validation.js";
import { getMemberProfile } from "../profiles/service.js";
import {
  acceptInvitation,
  createGroup,
  createInvitation,
  listGroupsForUser,
  listMembers,
  previewInvitation,
  publicGroup,
  requireMembership,
  revokeInvitation,
} from "./service.js";

function sendError(res, error) {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: error.message || "Internal server error" });
}

export function createGroupsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    try {
      const groups = await listGroupsForUser(req.db, req.user._id);
      return res.json({ groups });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/", async (req, res) => {
    try {
      const parsed = validateGroupCreate(req.body ?? {});
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const group = await createGroup(req.db, req.user, parsed.value);
      return res.status(201).json({ group });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/join", async (req, res) => {
    try {
      const parsed = validateInviteCode(req.body?.code);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const group = await acceptInvitation(req.db, parsed.value.code, req.user);
      return res.status(200).json({ group });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/invitations/preview", async (req, res) => {
    try {
      const parsed = validateInviteCode(req.query?.code);
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }
      const preview = await previewInvitation(req.db, parsed.value.code, req.user._id);
      return res.json(preview);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:groupId", async (req, res) => {
    try {
      const { group, membership } = await requireMembership(req.db, req.params.groupId, req.user._id);
      return res.json({ group: publicGroup(group, membership) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:groupId/members", async (req, res) => {
    try {
      const result = await listMembers(req.db, req.params.groupId, req.user._id);
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:groupId/members/:memberId", async (req, res) => {
    try {
      const profile = await getMemberProfile(
        req.db,
        req.params.groupId,
        req.params.memberId,
        req.user._id,
      );
      return res.json({ profile });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Profiles are read-only; role changes are not allowed through this surface.
  router.post("/:groupId/members/:memberId", (_req, res) => {
    return res.status(405).json({ error: "Member profiles cannot be modified through this API." });
  });
  router.patch("/:groupId/members/:memberId", (_req, res) => {
    return res.status(405).json({ error: "Member profiles cannot be modified through this API." });
  });
  router.put("/:groupId/members/:memberId", (_req, res) => {
    return res.status(405).json({ error: "Member profiles cannot be modified through this API." });
  });

  router.post("/:groupId/invitations", async (req, res) => {
    try {
      const invitation = await createInvitation(req.db, req.params.groupId, req.user);
      return res.status(201).json({ invitation });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/:groupId/invitations/:inviteId/revoke", async (req, res) => {
    try {
      const result = await revokeInvitation(
        req.db,
        req.params.groupId,
        req.params.inviteId,
        req.user._id,
      );
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}
