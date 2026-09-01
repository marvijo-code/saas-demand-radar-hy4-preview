import { Router } from 'express';
import { asyncHandler, conflict, notFoundError, ok } from '../lib/http.ts';
import { asEmail, asEnum, asObject, asString } from '../lib/validate.ts';
import { auth, requireAuth } from '../auth/session.ts';
import {
  countAdmins,
  countWorkspaceMembers,
  deleteUser,
  findUserByEmail,
  listMembers,
  updateUserRole,
  updateWorkspaceName,
} from '../repo/users.ts';
import { hashPassword, newId } from '../auth/passwords.ts';
import { createUser } from '../repo/users.ts';
import { recordAudit } from '../repo/audit.ts';

export const teamRouter = Router();

const ROLES = ['admin', 'member'] as const;

function members(workspaceId: string) {
  return listMembers(workspaceId).map((member) => ({
    id: member.id,
    email: member.email,
    name: member.name,
    role: member.role,
    createdAt: member.created_at,
    lastSeenAt: member.last_seen_at,
  }));
}

teamRouter.get(
  '/',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    return ok(res, {
      workspace: context.workspace,
      viewer: { id: context.user.id, role: context.user.role, email: context.user.email },
      members: members(context.workspace.id),
      stats: { admins: countAdmins(context.workspace.id), total: countWorkspaceMembers(context.workspace.id) },
    });
  }),
);

teamRouter.put(
  '/name',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const body = asObject(req.body);
    const name = asString(body.name, 'name', { max: 80 });
    const previous = context.workspace.name;
    updateWorkspaceName(context.workspace.id, name);
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'workspace.renamed',
      targetType: 'workspace',
      targetId: context.workspace.id,
      summary: `${context.user.email} renamed the workspace from "${previous}" to "${name}".`,
      metadata: { from: previous, to: name },
    });
    return ok(res, { name });
  }),
);

/** Admin-only member creation. The new account always lands in the caller's workspace. */
teamRouter.post(
  '/members',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const body = asObject(req.body);
    const email = asEmail(body.email, 'email');
    const name = asString(body.name, 'name', { max: 80 });
    const role = asEnum(body.role, 'role', ROLES, { fallback: 'member' });
    if (findUserByEmail(email)) {
      throw conflict('A user with that email already exists.');
    }
    const id = newId('usr');
    createUser({
      id,
      workspaceId: context.workspace.id,
      email,
      name,
      passwordHash: hashPassword(asString(body.password, 'password', { min: 10, max: 200, trim: false })),
      role,
    });
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'member.created',
      targetType: 'user',
      targetId: id,
      summary: `${context.user.email} invited ${email} as ${role}.`,
      metadata: { email, role },
    });
    return res.status(201).json({ members: members(context.workspace.id) });
  }),
);

teamRouter.patch(
  '/members/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const body = asObject(req.body);
    const role = asEnum(body.role, 'role', ROLES);
    const target = members(context.workspace.id).find((member) => member.id === req.params.id);
    if (!target) throw notFoundError('Member not found in this workspace.');
    if (target.role === 'admin' && role === 'member' && countAdmins(context.workspace.id) <= 1) {
      throw conflict('A workspace must keep at least one admin.');
    }
    updateUserRole(context.workspace.id, target.id, role);
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'member.role_changed',
      targetType: 'user',
      targetId: target.id,
      summary: `${context.user.email} changed ${target.email} from ${target.role} to ${role}.`,
      metadata: { from: target.role, to: role },
    });
    return ok(res, { members: members(context.workspace.id) });
  }),
);

teamRouter.delete(
  '/members/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const target = members(context.workspace.id).find((member) => member.id === req.params.id);
    if (!target) throw notFoundError('Member not found in this workspace.');
    if (target.id === context.user.id) {
      throw conflict('You cannot remove your own account.');
    }
    if (target.role === 'admin' && countAdmins(context.workspace.id) <= 1) {
      throw conflict('A workspace must keep at least one admin.');
    }
    deleteUser(context.workspace.id, target.id);
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'member.removed',
      targetType: 'user',
      targetId: target.id,
      summary: `${context.user.email} removed ${target.email} from the workspace.`,
    });
    return ok(res, { members: members(context.workspace.id) });
  }),
);
