import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export const workforceRoles = [
  "Guard",
  "Supervisor",
  "Security Officer",
  "Field Officer",
  "Management",
  "Control Room",
] as const;

export type WorkforceRole = (typeof workforceRoles)[number];

export type WorkforceAccess = {
  userId: string;
  role: WorkforceRole;
  siteName: string;
  fieldOfficerId?: string;
};

type Assignment = Omit<WorkforceAccess, "userId">;
type AuthClaims = {
  sessionClaims?: Record<string, unknown> | null;
};

export const defaultSiteName = "Northgate Business Park";
// New accounts start with the least-privileged workforce view until an
// administrator assigns a role through the environment or Clerk claims.
const defaultRole: WorkforceRole = "Guard";

declare global {
  namespace Express {
    interface Request {
      workforceAccess?: WorkforceAccess;
    }
  }
}

function isWorkforceRole(value: unknown): value is WorkforceRole {
  return typeof value === "string" && workforceRoles.includes(value as WorkforceRole);
}

export function assignmentFromMetadata(value: unknown): Partial<Assignment> {
  if (!value || typeof value !== "object") return {};
  const metadata = value as Record<string, unknown>;
  return {
    ...(isWorkforceRole(metadata.role) ? { role: metadata.role } : {}),
    ...(typeof metadata.siteName === "string" ? { siteName: metadata.siteName } : {}),
    ...(typeof metadata.fieldOfficerId === "string" ? { fieldOfficerId: metadata.fieldOfficerId } : {}),
  };
}

function configuredAssignments(): Record<string, Assignment> {
  const raw = process.env.WORKFORCE_ROLE_ASSIGNMENTS_JSON;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<Assignment>>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([userId, assignment]) => {
        if (!isWorkforceRole(assignment.role)) return [];
        return [[userId, {
          role: assignment.role,
          siteName: assignment.siteName?.trim() || defaultSiteName,
          ...(assignment.fieldOfficerId ? { fieldOfficerId: assignment.fieldOfficerId } : {}),
        }]];
      }),
    );
  } catch {
    return {};
  }
}

function claimAssignment(auth: AuthClaims): Partial<Assignment> {
  const claims = auth.sessionClaims;
  return assignmentFromMetadata(claims?.metadata ?? claims?.publicMetadata);
}

function resolveAccess(userId: string, auth: AuthClaims): WorkforceAccess {
  const configured = configuredAssignments()[userId];
  const claims = claimAssignment(auth);
  const roleFromEnv = process.env.WORKFORCE_DEFAULT_ROLE?.trim();
  const role = configured?.role ?? claims.role ?? (isWorkforceRole(roleFromEnv) ? roleFromEnv : defaultRole);
  return {
    userId,
    role,
    siteName: configured?.siteName ?? (claims.siteName?.trim() || process.env.WORKFORCE_DEFAULT_SITE?.trim() || defaultSiteName),
    ...(configured?.fieldOfficerId ?? claims.fieldOfficerId
      ? { fieldOfficerId: configured?.fieldOfficerId ?? claims.fieldOfficerId }
      : {}),
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const authWithClaims = auth as unknown as AuthClaims & { userId?: string };
  const userId = typeof authWithClaims.userId === "string"
    ? authWithClaims.userId
    : typeof authWithClaims.sessionClaims?.userId === "string"
      ? authWithClaims.sessionClaims.userId
      : undefined;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  req.workforceAccess = resolveAccess(userId, authWithClaims);
  next();
}

export function requireRole(...allowedRoles: WorkforceRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.workforceAccess || !allowedRoles.includes(req.workforceAccess.role)) {
      res.status(403).json({ error: "Your workforce role is not allowed to access this operation." });
      return;
    }
    next();
  };
}

export function hasRole(req: Request, ...allowedRoles: WorkforceRole[]): boolean {
  return Boolean(req.workforceAccess && allowedRoles.includes(req.workforceAccess.role));
}

export function canViewEmployeeDetails(req: Request): boolean {
  return canViewEmployeeAccess(req.workforceAccess);
}

export function canViewEmployeeAccess(access?: WorkforceAccess): boolean {
  return Boolean(access && ["Supervisor", "Security Officer", "Management", "Control Room"].includes(access.role));
}

export function operatorFor(req: Request): string {
  return req.workforceAccess?.userId ?? "System";
}