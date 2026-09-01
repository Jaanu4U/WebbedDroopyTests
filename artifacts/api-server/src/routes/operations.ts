import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { clerkClient } from "@clerk/express";
import { asc, desc, and, eq, notInArray } from "drizzle-orm";
import {
  db,
  attendanceRecordsTable,
  checklistItemsTable,
  employeeSubmissionsTable,
  guardsTable,
  requestsTable,
  sosAlertsTable,
  operatingPoliciesTable,
  operatingPolicyRevisionsTable,
} from "@workspace/db";
import {
  PunchAttendanceBody,
  CheckInGuardParams,
  CreateBillSubmissionBody,
  CreateLeaveRequestBody,
  CreateSalaryAdvanceRequestBody,
  DecideEmployeeSubmissionBody,
  DecideEmployeeSubmissionParams,
  GetEmployeeSubmissionsQueryParams,
  GetFieldOfficerTrackingQueryParams,
  GetAdminWorkforceUsersQueryParams,
  GetOperatingPolicyRevisionsQueryParams,
  ExportOperatingPolicyRevisionParams,
  SubmitEmployeeDetailsBody,
  TriggerSosBody,
  UpdateChecklistItemBody,
  UpdateChecklistItemParams,
  UpdateOperatingPolicyBody,
  UpdateAdminWorkforceUserAssignmentBody,
  UpdateAdminWorkforceUserAssignmentParams,
} from "@workspace/api-zod";
import {
  assignmentFromMetadata,
  canViewEmployeeAccess,
  canViewEmployeeDetails,
  hasRole,
  operatorFor,
  requireAuth,
  requireRole,
  defaultSiteName,
  type WorkforceAccess,
} from "../middlewares/auth";

const router: IRouter = Router();

const activities = [
  { id: "a-001", title: "Employee submission needs review", detail: "Nitin Sharma · submitted by Rohan Desai", time: "12 min ago", tone: "warning" },
  { id: "a-002", title: "Patrol round completed", detail: "Northgate Business Park · 8 of 8 checkpoints", time: "28 min ago", tone: "success" },
  { id: "a-003", title: "Late arrival flagged", detail: "Rakesh Patel · Lobby post", time: "41 min ago", tone: "danger" },
  { id: "a-004", title: "Daily report approved", detail: "Whitefield site · Security Officer", time: "1 hr ago", tone: "info" },
];

const contacts = [
  { id: "contact-001", name: "Anil Joseph", role: "Control Room Lead", phone: "+91 80 4123 8801", availability: "Available now" },
  { id: "contact-002", name: "Meera Nair", role: "Operations Manager", phone: "+91 98450 21048", availability: "Available now" },
  { id: "contact-003", name: "Ravi Shukla", role: "Area Officer · North", phone: "+91 99001 76342", availability: "On call" },
];

const payslips = [
  { id: "pay-001", period: "August 2026", netPay: 28450, releasedAt: "31 Aug 2026", status: "Available" },
  { id: "pay-002", period: "July 2026", netPay: 28100, releasedAt: "31 Jul 2026", status: "Available" },
  { id: "pay-003", period: "June 2026", netPay: 27950, releasedAt: "30 Jun 2026", status: "Available" },
];

const siteReport = {
  date: "01 Sep 2026",
  site: "Northgate Business Park",
  coverage: 92,
  attendance: 88,
  patrolCompletion: 96,
  openIssues: 3,
  status: "Draft · review by 18:00",
};

type ShiftRule = { id: string; name: string; startTime: string; endTime: string };
type ChecklistRule = { id: string; label: string; category: string; required: boolean };
type PolicyInput = {
  siteName: string;
  siteAddress: string;
  timezone: string;
  shifts: ShiftRule[];
  geofenceRadiusMeters: number;
  geofenceRequireInside: boolean;
  tracking: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    heartbeatMinutes: number;
    offlineAfterMinutes: number;
  };
  checklist: ChecklistRule[];
  sosAcknowledgementMinutes: number;
  sosEscalationMessage: string;
  approvals: {
    verification: string[];
    leave: string[];
    salaryAdvance: string[];
    bills: string[];
  };
  requests: {
    salaryAdvanceEnabled: boolean;
    salaryAdvanceMaxAmount: number;
    billSubmissionEnabled: boolean;
    billMaxAmount: number;
    billReceiptRequired: boolean;
  };
};
type PolicySectionSnapshot = Record<string, unknown>;

const defaultPolicy: PolicyInput = {
  siteName: "Northgate Business Park",
  siteAddress: "Outer Ring Road, Whitefield, Bengaluru",
  timezone: "Asia/Kolkata",
  shifts: [
    { id: "morning", name: "Morning", startTime: "06:00", endTime: "14:00" },
    { id: "evening", name: "Evening", startTime: "14:00", endTime: "22:00" },
    { id: "night", name: "Night", startTime: "22:00", endTime: "06:00" },
  ],
  geofenceRadiusMeters: 150,
  geofenceRequireInside: true,
  tracking: {
    enabled: true,
    startTime: "06:00",
    endTime: "22:00",
    heartbeatMinutes: 5,
    offlineAfterMinutes: 15,
  },
  checklist: [
    { id: "c-001", label: "Uniform and grooming check", category: "Readiness", required: true },
    { id: "c-002", label: "Morning briefing completed", category: "Readiness", required: true },
    { id: "c-003", label: "Radio and torch issued", category: "Equipment", required: true },
    { id: "c-004", label: "Post instructions acknowledged", category: "Handover", required: true },
    { id: "c-005", label: "Perimeter and access points inspected", category: "Handover", required: false },
  ],
  sosAcknowledgementMinutes: 5,
  sosEscalationMessage: "Control Room must acknowledge an SOS before the timer expires.",
  approvals: {
    verification: ["Supervisor", "Security Officer", "Management"],
    leave: ["Supervisor"],
    salaryAdvance: ["Supervisor", "Management"],
    bills: ["Supervisor", "Management"],
  },
  requests: {
    salaryAdvanceEnabled: true,
    salaryAdvanceMaxAmount: 15000,
    billSubmissionEnabled: true,
    billMaxAmount: 25000,
    billReceiptRequired: true,
  },
};

function policyResponse(record: typeof operatingPoliciesTable.$inferSelect) {
  return {
    id: record.id,
    version: record.version,
    siteName: record.siteName,
    siteAddress: record.siteAddress,
    timezone: record.timezone,
    shifts: record.shifts as ShiftRule[],
    geofenceRadiusMeters: record.geofenceRadiusMeters,
    geofenceRequireInside: record.geofenceRequireInside,
    tracking: {
      enabled: record.trackingEnabled,
      startTime: record.trackingStartTime,
      endTime: record.trackingEndTime,
      heartbeatMinutes: record.trackingHeartbeatMinutes,
      offlineAfterMinutes: record.trackingOfflineAfterMinutes,
    },
    checklist: record.checklistItems as ChecklistRule[],
    sosAcknowledgementMinutes: record.sosAcknowledgementMinutes,
    sosEscalationMessage: record.sosEscalationMessage,
    approvals: {
      verification: record.verificationApprovalRoles as string[],
      leave: record.leaveApprovalRoles as string[],
      salaryAdvance: record.salaryAdvanceApprovalRoles as string[],
      bills: record.billApprovalRoles as string[],
    },
    requests: {
      salaryAdvanceEnabled: record.salaryAdvanceEnabled,
      salaryAdvanceMaxAmount: record.salaryAdvanceMaxAmount,
      billSubmissionEnabled: record.billSubmissionEnabled,
      billMaxAmount: record.billMaxAmount,
      billReceiptRequired: record.billReceiptRequired,
    },
    updatedAt: record.updatedAt.toISOString(),
    updatedBy: record.updatedBy ?? "System",
  };
}

function policyInputFromRecord(record: typeof operatingPoliciesTable.$inferSelect): PolicyInput {
  const response = policyResponse(record);
  return {
    siteName: response.siteName,
    siteAddress: response.siteAddress,
    timezone: response.timezone,
    shifts: response.shifts,
    geofenceRadiusMeters: response.geofenceRadiusMeters,
    geofenceRequireInside: response.geofenceRequireInside,
    tracking: response.tracking,
    checklist: response.checklist,
    sosAcknowledgementMinutes: response.sosAcknowledgementMinutes,
    sosEscalationMessage: response.sosEscalationMessage,
    approvals: response.approvals,
    requests: response.requests,
  };
}

function policySectionSnapshots(policy: PolicyInput): PolicySectionSnapshot {
  return {
    site: {
      siteName: policy.siteName,
      siteAddress: policy.siteAddress,
      timezone: policy.timezone,
      shifts: policy.shifts,
    },
    attendance: {
      geofenceRadiusMeters: policy.geofenceRadiusMeters,
      geofenceRequireInside: policy.geofenceRequireInside,
    },
    tracking: policy.tracking,
    checklist: policy.checklist,
    sos: {
      sosAcknowledgementMinutes: policy.sosAcknowledgementMinutes,
      sosEscalationMessage: policy.sosEscalationMessage,
    },
    approvals: policy.approvals,
    requests: policy.requests,
  };
}

function snapshotsForSections(
  snapshots: PolicySectionSnapshot,
  sections: string[],
): PolicySectionSnapshot {
  return Object.fromEntries(
    sections
      .filter((section) => section in snapshots)
      .map((section) => [section, snapshots[section]]),
  );
}

function changedPolicySections(
  existing: typeof operatingPoliciesTable.$inferSelect,
  next: ReturnType<typeof UpdateOperatingPolicyBody.parse>,
): string[] {
  const previous = policyInputFromRecord(existing);
  const previousSnapshots = policySectionSnapshots(previous);
  const nextSnapshots = policySectionSnapshots(next);

  return Object.keys(previousSnapshots)
    .filter((section) =>
      JSON.stringify(previousSnapshots[section]) !==
      JSON.stringify(nextSnapshots[section]),
    )
    .map((section) => section);
}

function policyRevisionResponse(
  record: typeof operatingPolicyRevisionsTable.$inferSelect,
) {
  return {
    id: record.id,
    policyId: record.policyId,
    changedSections: record.changedSections,
    before: record.beforeValues ?? {},
    after: record.afterValues ?? {},
    reason: record.reason,
    actor: record.actor,
    createdAt: record.createdAt.toISOString(),
  };
}

const policySectionLabels: Record<string, string> = {
  site: "Site and shifts",
  attendance: "Attendance and geofence",
  tracking: "Live tracking",
  checklist: "Daily checklist",
  sos: "SOS response",
  approvals: "Approval routing",
  requests: "Employee requests",
};

type RevisionValueRow = { label: string; value: string };

function revisionDisplay(value: unknown, fallback: unknown = "—"): string {
  return value === null || value === undefined || value === "" ? String(fallback) : String(value);
}

function revisionObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function revisionBoolean(value: unknown): string {
  return value === true ? "Yes" : value === false ? "No" : revisionDisplay(value);
}

function revisionRolePath(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.join(" → ") : "No approval roles";
}

function revisionShifts(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "No shifts configured";
  return value.map((shift) => {
    const entry = revisionObject(shift);
    if (!entry) return revisionDisplay(shift);
    return `${revisionDisplay(entry.name)} · ${revisionDisplay(entry.startTime)}–${revisionDisplay(entry.endTime)}`;
  }).join("\n");
}

function revisionChecklist(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "No checklist items";
  return value.map((item) => {
    const entry = revisionObject(item);
    if (!entry) return revisionDisplay(item);
    return `${revisionDisplay(entry.label)} · ${revisionDisplay(entry.category)} · ${entry.required === true ? "Required" : "Optional"}`;
  }).join("\n");
}

function revisionMoney(value: unknown): string {
  return typeof value === "number"
    ? `₹${value.toLocaleString("en-IN")}`
    : revisionDisplay(value);
}

function revisionValueRows(section: string, value: unknown): RevisionValueRow[] {
  if (section === "checklist") {
    return [{ label: "Checklist items", value: revisionChecklist(value) }];
  }

  const snapshot = revisionObject(value);
  if (!snapshot) return [{ label: "Value", value: revisionDisplay(value, "Not recorded") }];

  if (section === "site") {
    return [
      { label: "Site name", value: revisionDisplay(snapshot.siteName) },
      { label: "Site address", value: revisionDisplay(snapshot.siteAddress) },
      { label: "Time zone", value: revisionDisplay(snapshot.timezone) },
      { label: "Shifts", value: revisionShifts(snapshot.shifts) },
    ];
  }
  if (section === "attendance") {
    return [
      { label: "Geofence radius", value: `${revisionDisplay(snapshot.geofenceRadiusMeters)} metres` },
      { label: "Require presence inside geofence", value: revisionBoolean(snapshot.geofenceRequireInside) },
    ];
  }
  if (section === "tracking") {
    return [
      { label: "Location tracking", value: snapshot.enabled === true ? "Enabled" : snapshot.enabled === false ? "Disabled" : revisionDisplay(snapshot.enabled) },
      { label: "Operating window", value: `${revisionDisplay(snapshot.startTime)}–${revisionDisplay(snapshot.endTime)}` },
      { label: "Heartbeat", value: `${revisionDisplay(snapshot.heartbeatMinutes)} minutes` },
      { label: "Offline after", value: `${revisionDisplay(snapshot.offlineAfterMinutes)} minutes` },
    ];
  }
  if (section === "sos") {
    return [
      { label: "Acknowledgement window", value: `${revisionDisplay(snapshot.sosAcknowledgementMinutes)} minutes` },
      { label: "Escalation instruction", value: revisionDisplay(snapshot.sosEscalationMessage) },
    ];
  }
  if (section === "approvals") {
    return [
      { label: "Employee verification", value: revisionRolePath(snapshot.verification) },
      { label: "Leave requests", value: revisionRolePath(snapshot.leave) },
      { label: "Salary advances", value: revisionRolePath(snapshot.salaryAdvance) },
      { label: "Bill submissions", value: revisionRolePath(snapshot.bills) },
    ];
  }
  if (section === "requests") {
    const salaryAdvance = revisionObject(snapshot.salaryAdvance) ?? (
      "salaryAdvanceEnabled" in snapshot || "salaryAdvanceMaxAmount" in snapshot
        ? {
            enabled: snapshot.salaryAdvanceEnabled,
            maxAmount: snapshot.salaryAdvanceMaxAmount,
          }
        : null
    );
    const bills = revisionObject(snapshot.bills) ?? (
      "billSubmissionEnabled" in snapshot ||
      "billMaxAmount" in snapshot ||
      "billReceiptRequired" in snapshot
        ? {
            enabled: snapshot.billSubmissionEnabled,
            maxAmount: snapshot.billMaxAmount,
            receiptRequired: snapshot.billReceiptRequired,
          }
        : null
    );
    return [
      {
        label: "Salary advances",
        value: salaryAdvance
          ? `${revisionBoolean(salaryAdvance.enabled)} · up to ${revisionMoney(salaryAdvance.maxAmount)}`
          : "Not recorded",
      },
      {
        label: "Bill submissions",
        value: bills
          ? `${revisionBoolean(bills.enabled)} · up to ${revisionMoney(bills.maxAmount)} · Receipt ${bills.receiptRequired === true ? "required" : "optional"}`
          : "Not recorded",
      },
    ];
  }

  return Object.entries(snapshot).map(([key, entry]) => ({
    label: key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase()),
    value: Array.isArray(entry) ? entry.join(", ") : revisionDisplay(entry),
  }));
}

function formatRevisionTimestamp(value: Date): string {
  // Handover exports use UTC and ISO 8601 so the same artifact is stable across regions.
  return value.toISOString();
}

function indentRevisionValue(value: string): string {
  return value.replace(/\n/g, "\n          ");
}

function policyRevisionExport(
  record: typeof operatingPolicyRevisionsTable.$inferSelect,
): string {
  const before = record.beforeValues ?? {};
  const after = record.afterValues ?? {};
  const hasSnapshots = Object.keys(before).length > 0 || Object.keys(after).length > 0;
  const lines = [
    "BLACKBELT COMMANDOS",
    "Operating policy revision comparison",
    "",
    `Actor: ${record.actor}`,
    `Timestamp (UTC): ${formatRevisionTimestamp(record.createdAt)}`,
    `Reason: ${record.reason || "No reason provided."}`,
    `Changed sections: ${record.changedSections.map((section) => policySectionLabels[section] ?? section).join(", ") || "None"}`,
  ];

  if (!hasSnapshots) {
    lines.push("", "Before-and-after values were not recorded for this older revision.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "Comparison");
  for (const section of record.changedSections) {
    const beforeRows = revisionValueRows(section, before[section]);
    const afterRows = revisionValueRows(section, after[section]);
    lines.push("", policySectionLabels[section] ?? section);
    for (const [index, row] of beforeRows.entries()) {
      lines.push(
        `  ${row.label}`,
        `    Before: ${indentRevisionValue(row.value)}`,
        `    After: ${indentRevisionValue(afterRows[index]?.value ?? "Not recorded")}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

const fieldOfficers = [
  { id: "fo-001", name: "Rohan Desai", city: "Bengaluru", dutyStatus: "On duty", location: "Whitefield Main Road", lastUpdate: "1 min ago", coordinates: { x: 68, y: 34 } },
  { id: "fo-002", name: "Amit Kulkarni", city: "Mysuru", dutyStatus: "On duty", location: "Hebbal Industrial Area", lastUpdate: "3 min ago", coordinates: { x: 43, y: 62 } },
  { id: "fo-003", name: "Farhan Ali", city: "Bengaluru", dutyStatus: "On break", location: "Indiranagar", lastUpdate: "8 min ago", coordinates: { x: 78, y: 58 } },
  { id: "fo-004", name: "Neeraj Verma", city: "Tumakuru", dutyStatus: "Offline", location: "Tumakuru Central", lastUpdate: "42 min ago", coordinates: { x: 28, y: 28 } },
];

function workforceUserResponse(user: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddresses: Array<{ emailAddress: string }>;
  primaryEmailAddress: { emailAddress: string } | null;
  publicMetadata: unknown;
}) {
  const assignment = assignmentFromMetadata(user.publicMetadata);
  const metadata = user.publicMetadata && typeof user.publicMetadata === "object"
    ? user.publicMetadata as Record<string, unknown>
    : {};
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || email || "Unnamed Clerk user";
  return {
    userId: user.id,
    displayName,
    email,
    role: assignment.role ?? "Guard",
    siteName: assignment.siteName?.trim() || defaultSiteName,
    fieldOfficerId: assignment.fieldOfficerId ?? null,
    assignmentUpdatedAt: typeof metadata.workforceAssignmentUpdatedAt === "string" ? metadata.workforceAssignmentUpdatedAt : null,
    assignmentUpdatedBy: typeof metadata.workforceAssignmentUpdatedBy === "string" ? metadata.workforceAssignmentUpdatedBy : null,
  };
}

const todayKey = () => new Date().toISOString().slice(0, 10);
const offsetDate = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const atTime = (date: string, time: string) => new Date(`${date}T${time}:00.000Z`);
const now = () => new Date();
const timestampMinutes = (value: Date) => value.getUTCHours() * 60 + value.getUTCMinutes();
const timestampMinutesFromString = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

function zonedTimeMinutes(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const hours = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minutes = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hours * 60 + minutes;
}

function isWithinDutyWindow(value: Date, startTime: string, endTime: string, timeZone: string): boolean {
  const minutes = zonedTimeMinutes(value, timeZone);
  const start = timestampMinutesFromString(startTime);
  const end = timestampMinutesFromString(endTime);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function timeValue(value: Date | null) {
  return value ? value.toISOString().slice(11, 16) : null;
}

function lastSeenValue(value: Date | null) {
  if (!value) return "—";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - value.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  return `${Math.floor(elapsedMinutes / 60)} hr ago`;
}

function submissionTimeValue(value: Date) {
  const today = todayKey();
  const date = value.toISOString().slice(0, 10);
  if (date === today) return `Today, ${timeValue(value)}`;
  const yesterday = new Date(`${today}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) {
    return `Yesterday, ${timeValue(value)}`;
  }
  return `${date}, ${timeValue(value)}`;
}

function attendanceResponse(
  record: typeof attendanceRecordsTable.$inferSelect,
  policy: PolicyInput,
  access?: WorkforceAccess,
) {
  const shift = policy.shifts.find((item) => record.shift.toLowerCase().includes(item.name.toLowerCase())) ?? policy.shifts[0];
  return {
    id: record.id,
    employeeName: access && !canViewEmployeeAccess(access)
      ? "Your assigned record"
      : record.employeeName,
    shift: record.shift,
    site: record.site,
    status: record.status,
    punchIn: timeValue(record.punchInAt),
    punchOut: timeValue(record.punchOutAt),
    geofence: record.geofence,
    siteAddress: policy.siteAddress,
    geofenceRadiusMeters: policy.geofenceRadiusMeters,
    shiftWindow: shift ? `${shift.startTime}–${shift.endTime}` : "Configured shift window",
  };
}

function guardResponse(record: typeof guardsTable.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    post: record.post,
    shift: record.shift,
    status: record.status,
    lastSeen: lastSeenValue(record.lastSeenAt),
  };
}

function checklistResponse(record: typeof checklistItemsTable.$inferSelect) {
  return {
    id: record.id,
    label: record.label,
    category: record.category,
    required: record.required,
    completed: record.completed,
  };
}

function submissionResponse(
  record: typeof employeeSubmissionsTable.$inferSelect,
  policy: PolicyInput,
  access?: WorkforceAccess,
) {
  return {
    id: record.id,
    name: record.name,
    phone: access && !canViewEmployeeAccess(access)
      ? "Restricted"
      : record.phone,
    city: record.city,
    submittedBy: record.submittedBy,
    submittedAt: submissionTimeValue(record.submittedAt),
    status: record.status,
    documents: record.documents,
    note: record.note,
    decisionAt: record.decisionAt?.toISOString() ?? null,
    decisionBy: record.decisionBy,
    approvalPath: policy.approvals.verification.join(" → "),
  };
}

function sosResponse(record: typeof sosAlertsTable.$inferSelect, policy: PolicyInput) {
  const acknowledgementDueAt = new Date(
    record.createdAt.getTime() + policy.sosAcknowledgementMinutes * 60_000,
  );
  return {
    id: record.id,
    status: record.status,
    employeeName: record.employeeName,
    location: record.location,
    createdAt: record.createdAt.toISOString(),
    triggeredBy: record.triggeredBy,
    acknowledgementWindowMinutes: policy.sosAcknowledgementMinutes,
    acknowledgementDueAt: acknowledgementDueAt.toISOString(),
  };
}

function requestResponse(record: typeof requestsTable.$inferSelect, policy: PolicyInput) {
  const approvalPath =
    record.type === "Leave request" ? policy.approvals.leave.join(" → ") :
    record.type === "Salary advance" ? policy.approvals.salaryAdvance.join(" → ") :
    policy.approvals.bills.join(" → ");
  return {
    id: record.id,
    type: record.type,
    summary: record.summary,
    submittedAt: record.submittedAt.toISOString(),
    status: record.status,
    submittedBy: record.submittedBy,
    approvalPath,
  };
}

async function seedOperationalData() {
  const today = todayKey();
  let [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  if (!policyRecord) {
    [policyRecord] = await db.insert(operatingPoliciesTable).values({
      id: "operating-policy",
      siteName: defaultPolicy.siteName,
      siteAddress: defaultPolicy.siteAddress,
      timezone: defaultPolicy.timezone,
      shifts: defaultPolicy.shifts,
      geofenceRadiusMeters: defaultPolicy.geofenceRadiusMeters,
      geofenceRequireInside: defaultPolicy.geofenceRequireInside,
      trackingEnabled: defaultPolicy.tracking.enabled,
      trackingStartTime: defaultPolicy.tracking.startTime,
      trackingEndTime: defaultPolicy.tracking.endTime,
      trackingHeartbeatMinutes: defaultPolicy.tracking.heartbeatMinutes,
      trackingOfflineAfterMinutes: defaultPolicy.tracking.offlineAfterMinutes,
      checklistItems: defaultPolicy.checklist,
      sosAcknowledgementMinutes: defaultPolicy.sosAcknowledgementMinutes,
      sosEscalationMessage: defaultPolicy.sosEscalationMessage,
      verificationApprovalRoles: defaultPolicy.approvals.verification,
      leaveApprovalRoles: defaultPolicy.approvals.leave,
      salaryAdvanceApprovalRoles: defaultPolicy.approvals.salaryAdvance,
      billApprovalRoles: defaultPolicy.approvals.bills,
      salaryAdvanceEnabled: defaultPolicy.requests.salaryAdvanceEnabled,
      salaryAdvanceMaxAmount: defaultPolicy.requests.salaryAdvanceMaxAmount,
      billSubmissionEnabled: defaultPolicy.requests.billSubmissionEnabled,
      billMaxAmount: defaultPolicy.requests.billMaxAmount,
      billReceiptRequired: defaultPolicy.requests.billReceiptRequired,
    }).returning();
  }
  const policy = policyInputFromRecord(policyRecord);
  const primaryShift = policy.shifts[0];
  await db.insert(attendanceRecordsTable).values({
    id: `att-${today}`,
    employeeName: "Arjun Mehta",
    shift: primaryShift ? `${primaryShift.name} · ${primaryShift.startTime}–${primaryShift.endTime}` : "Configured shift",
    site: policy.siteName,
    status: "On duty",
    punchInAt: atTime(today, "05:56"),
    punchOutAt: null,
    geofence: policy.geofenceRequireInside ? `Inside ${policy.siteName} geofence (${policy.geofenceRadiusMeters}m)` : "Geofence check not required",
    attendanceDate: today,
  }).onConflictDoNothing();

  const currentTime = Date.now();
  await db.insert(guardsTable).values([
    { id: "g-001", name: "Vikram Singh", role: "Security Guard", post: "Gate A", shift: "Morning", status: "On duty", lastSeenAt: new Date(currentTime - 30_000) },
    { id: "g-002", name: "Manoj Kumar", role: "Security Guard", post: "Loading Bay", shift: "Morning", status: "On duty", lastSeenAt: new Date(currentTime - 4 * 60_000) },
    { id: "g-003", name: "Rakesh Patel", role: "Security Guard", post: "Lobby", shift: "Morning", status: "Late", lastSeenAt: new Date(currentTime - 18 * 60_000) },
    { id: "g-004", name: "Sanjay Rao", role: "Security Guard", post: "Parking P2", shift: "Morning", status: "Not checked in", lastSeenAt: null },
    { id: "g-005", name: "Devendra Yadav", role: "Security Guard", post: "East Perimeter", shift: "Morning", status: "On duty", lastSeenAt: new Date(currentTime - 8 * 60_000) },
    { id: "g-006", name: "Karan Joshi", role: "Security Guard", post: "Server Wing", shift: "Morning", status: "On duty", lastSeenAt: new Date(currentTime - 12 * 60_000) },
  ]).onConflictDoNothing();

  await db.insert(checklistItemsTable).values(policy.checklist.map((item, index) => ({
    ...item,
    completed: index < 2,
  }))).onConflictDoNothing();

  await db.insert(employeeSubmissionsTable).values([
    { id: "sub-001", name: "Nitin Sharma", phone: "+91 98765 44321", city: "Bengaluru", submittedBy: "Rohan Desai", submittedAt: atTime(today, "09:42"), status: "Under Verification", documents: 4, note: "New guard for Whitefield deployment" },
    { id: "sub-002", name: "Priya Menon", phone: "+91 99887 10293", city: "Bengaluru", submittedBy: "Rohan Desai", submittedAt: atTime(offsetDate(today, -1), "16:18"), status: "Sent Back", documents: 3, note: "Please provide updated address proof" },
    { id: "sub-003", name: "Suresh Babu", phone: "+91 91234 87654", city: "Mysuru", submittedBy: "Amit Kulkarni", submittedAt: atTime(offsetDate(today, -1), "11:06"), status: "Accepted", documents: 5, note: null },
  ]).onConflictDoNothing();
}

let seedPromise: Promise<void> | undefined;
function ensureSeeded() {
  seedPromise ??= seedOperationalData();
  return seedPromise;
}

router.use(requireAuth);

router.use(async (_req, _res, next) => {
  try {
    await ensureSeeded();
    next();
  } catch (error) {
    next(error);
  }
});

router.get("/session", (req, res) => {
  const access = req.workforceAccess;
  if (!access) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json({
    userId: access.userId,
    role: access.role,
    siteName: access.siteName,
    fieldOfficerId: access.fieldOfficerId ?? null,
    permissions: {
      canViewEmployeeDetails: canViewEmployeeDetails(req),
      canViewFieldTracking: hasRole(req, "Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"),
      canManageTeam: hasRole(req, "Supervisor", "Security Officer", "Management", "Control Room"),
      canManagePolicies: hasRole(req, "Management"),
    },
  });
});

router.get("/admin/field-officers", requireRole("Management"), (_req, res) => {
  res.json(fieldOfficers.map(({ id, name, city, dutyStatus }) => ({ id, name, city, dutyStatus })));
});

router.get("/admin/workforce-users", requireRole("Management"), async (req, res) => {
  const query = GetAdminWorkforceUsersQueryParams.parse(req.query);
  try {
    const result = await clerkClient.users.getUserList({
      ...(query.search ? { query: query.search } : {}),
      limit: 100,
      orderBy: "-created_at",
    });
    res.json(result.data.map(workforceUserResponse));
  } catch {
    res.status(503).json({ error: "The Clerk user directory is temporarily unavailable." });
  }
});

router.patch("/admin/workforce-users/:userId/assignment", requireRole("Management"), async (req, res) => {
  const { userId } = UpdateAdminWorkforceUserAssignmentParams.parse(req.params);
  const body = UpdateAdminWorkforceUserAssignmentBody.parse(req.body);
  const siteName = body.siteName.trim();
  if (!siteName) {
    res.status(400).json({ error: "A site name is required." });
    return;
  }
  if (body.role === "Field Officer" && !body.fieldOfficerId) {
    res.status(422).json({ error: "Field Officer assignments must identify an officer record." });
    return;
  }
  if (body.fieldOfficerId && !fieldOfficers.some((officer) => officer.id === body.fieldOfficerId)) {
    res.status(422).json({ error: "The selected field officer record does not exist." });
    return;
  }

  let user;
  try {
    user = await clerkClient.users.getUser(userId);
  } catch {
    res.status(404).json({ error: "Clerk user not found." });
    return;
  }

  const updated = await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: {
      ...(user.publicMetadata ?? {}),
      role: body.role,
      siteName,
      fieldOfficerId: body.role === "Field Officer" ? body.fieldOfficerId : null,
      workforceAssignmentUpdatedAt: now().toISOString(),
      workforceAssignmentUpdatedBy: operatorFor(req),
    },
  });
  res.json(workforceUserResponse(updated));
});

router.get("/policies/operating", async (_req, res) => {
  const [record] = await db.select().from(operatingPoliciesTable).limit(1);
  if (!record) {
    res.status(404).json({ error: "Operating policy not found" });
    return;
  }
  res.json(policyResponse(record));
});

router.get("/policies/operating/revisions", requireRole("Management"), async (req, res) => {
  const query = GetOperatingPolicyRevisionsQueryParams.parse(req.query);
  const [policy] = await db.select({ id: operatingPoliciesTable.id })
    .from(operatingPoliciesTable)
    .limit(1);
  if (!policy) {
    res.status(404).json({ error: "Operating policy not found" });
    return;
  }

  const revisions = await db.select()
    .from(operatingPolicyRevisionsTable)
    .where(eq(operatingPolicyRevisionsTable.policyId, policy.id))
    .orderBy(
      desc(operatingPolicyRevisionsTable.createdAt),
      desc(operatingPolicyRevisionsTable.id),
    )
    .limit(query.limit)
    .offset(query.offset);

  res.json(revisions.map(policyRevisionResponse));
});

router.get("/policies/operating/revisions/:revisionId/export", requireRole("Management"), async (req, res): Promise<void> => {
  const params = ExportOperatingPolicyRevisionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [revision] = await db.select()
    .from(operatingPolicyRevisionsTable)
    .where(eq(operatingPolicyRevisionsTable.id, params.data.revisionId))
    .limit(1);
  if (!revision) {
    res.status(404).json({ error: "Policy revision not found" });
    return;
  }

  const filename = `policy-revision-${revision.id.replace(/[^a-zA-Z0-9_-]/g, "-")}.txt`;
  res
    .type("text/plain")
    .set("Content-Disposition", `attachment; filename="${filename}"`)
    .send(policyRevisionExport(revision));
});

router.patch("/policies/operating", requireRole("Management"), async (req, res) => {
  const body = UpdateOperatingPolicyBody.parse(req.body);
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(operatingPoliciesTable).limit(1);
    if (!existing) {
      return undefined;
    }
    if (existing.version !== body.version) {
      return {
        conflict: true as const,
        currentPolicy: policyResponse(existing),
      };
    }

    const changedSections = changedPolicySections(existing, body);
    const previousSnapshots = policySectionSnapshots(policyInputFromRecord(existing));
    const nextSnapshots = policySectionSnapshots(body);
    const actor = operatorFor(req);
    const [updatedPolicy] = await tx.update(operatingPoliciesTable).set({
      siteName: body.siteName,
      siteAddress: body.siteAddress,
      timezone: body.timezone,
      shifts: body.shifts,
      geofenceRadiusMeters: body.geofenceRadiusMeters,
      geofenceRequireInside: body.geofenceRequireInside,
      trackingEnabled: body.tracking.enabled,
      trackingStartTime: body.tracking.startTime,
      trackingEndTime: body.tracking.endTime,
      trackingHeartbeatMinutes: body.tracking.heartbeatMinutes,
      trackingOfflineAfterMinutes: body.tracking.offlineAfterMinutes,
      checklistItems: body.checklist,
      sosAcknowledgementMinutes: body.sosAcknowledgementMinutes,
      sosEscalationMessage: body.sosEscalationMessage,
      verificationApprovalRoles: body.approvals.verification,
      leaveApprovalRoles: body.approvals.leave,
      salaryAdvanceApprovalRoles: body.approvals.salaryAdvance,
      billApprovalRoles: body.approvals.bills,
      salaryAdvanceEnabled: body.requests.salaryAdvanceEnabled,
      salaryAdvanceMaxAmount: body.requests.salaryAdvanceMaxAmount,
      billSubmissionEnabled: body.requests.billSubmissionEnabled,
      billMaxAmount: body.requests.billMaxAmount,
      billReceiptRequired: body.requests.billReceiptRequired,
      updatedBy: actor,
      updatedAt: now(),
      version: existing.version + 1,
    }).where(
      and(
        eq(operatingPoliciesTable.id, existing.id),
        eq(operatingPoliciesTable.version, body.version),
      ),
    ).returning();
    if (!updatedPolicy) {
      const [currentPolicy] = await tx.select().from(operatingPoliciesTable)
        .where(eq(operatingPoliciesTable.id, existing.id))
        .limit(1);
      return currentPolicy
        ? {
            conflict: true as const,
            currentPolicy: policyResponse(currentPolicy),
          }
        : undefined;
    }

    const configuredChecklistIds = body.checklist.map((item) => item.id);
    if (configuredChecklistIds.length > 0) {
      await tx.delete(checklistItemsTable)
        .where(notInArray(checklistItemsTable.id, configuredChecklistIds));
    } else {
      await tx.delete(checklistItemsTable);
    }
    for (const item of body.checklist) {
      await tx.insert(checklistItemsTable).values({
        ...item,
        completed: false,
      }).onConflictDoUpdate({
        target: checklistItemsTable.id,
        set: {
          label: item.label,
          category: item.category,
          required: item.required,
          completed: false,
          completedAt: null,
          completedBy: null,
          updatedAt: now(),
        },
      });
    }

    if (changedSections.length > 0) {
      await tx.insert(operatingPolicyRevisionsTable).values({
        id: randomUUID(),
        policyId: existing.id,
        changedSections,
        beforeValues: snapshotsForSections(previousSnapshots, changedSections),
        afterValues: snapshotsForSections(nextSnapshots, changedSections),
        reason: body.changeReason?.trim() || null,
        actor,
      });
    }

    const [todayAttendance] = await tx.select().from(attendanceRecordsTable)
      .where(eq(attendanceRecordsTable.attendanceDate, todayKey()));
    const primaryShift = body.shifts[0];
    if (todayAttendance && primaryShift) {
      await tx.update(attendanceRecordsTable).set({
        site: body.siteName,
        shift: `${primaryShift.name} · ${primaryShift.startTime}–${primaryShift.endTime}`,
        geofence: body.geofenceRequireInside
          ? `Inside ${body.siteName} geofence (${body.geofenceRadiusMeters}m)`
          : "Geofence check not required",
        updatedAt: now(),
      }).where(eq(attendanceRecordsTable.id, todayAttendance.id));
    }

    return updatedPolicy;
  });

  if (!updated) {
    res.status(404).json({ error: "Operating policy not found" });
    return;
  }
  if ("conflict" in updated) {
    res.status(409).json({
      error: "This operating policy changed after you loaded it. Refresh the policy and retry your changes.",
      currentPolicy: updated.currentPolicy,
    });
    return;
  }

  res.json(policyResponse(updated));
});

router.get("/dashboard/summary", (_req, res) => {
  res.json({ coverage: 92, attendance: 88, patrol: 96, incidents: 2, openApprovals: 7, fieldOfficers: 12 });
});

router.get("/activity", (_req, res) => {
  res.json(activities);
});

router.get("/attendance/today", async (req, res) => {
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const [record] = await db.select().from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.attendanceDate, todayKey()));
  if (!record) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }
  res.json(attendanceResponse(record, policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy, req.workforceAccess));
});

router.post("/attendance/punch", async (req, res) => {
  const body = PunchAttendanceBody.parse(req.body);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  if (policy.geofenceRequireInside && body.geofenceVerified !== true) {
    res.status(422).json({ error: `Attendance can only be recorded inside the ${policy.geofenceRadiusMeters}m site geofence.` });
    return;
  }
  const attendanceDate = todayKey();
  const [record] = await db.select().from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.attendanceDate, attendanceDate));
  if (!record) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }
  const timestamp = now();
  const activeShift = policy.shifts.find((shift) => {
    const minutes = timestampMinutes(timestamp);
    const start = timestampMinutesFromString(shift.startTime);
    const end = timestampMinutesFromString(shift.endTime);
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }) ?? policy.shifts[0];
  const [updated] = await db.update(attendanceRecordsTable)
    .set({
      ...(body.action === "in"
        ? { punchInAt: timestamp, status: "On duty", shift: activeShift ? `${activeShift.name} · ${activeShift.startTime}–${activeShift.endTime}` : record.shift }
        : { punchOutAt: timestamp, status: "Shift complete" }),
      site: policy.siteName,
      geofence: policy.geofenceRequireInside
        ? `Inside ${policy.siteName} geofence (${policy.geofenceRadiusMeters}m)`
        : body.location,
      updatedAt: timestamp,
    })
    .where(eq(attendanceRecordsTable.id, record.id))
    .returning();
  res.json(attendanceResponse(updated, policy, req.workforceAccess));
});

router.get("/emergency/sos", async (_req, res) => {
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const alerts = await db.select().from(sosAlertsTable)
    .orderBy(desc(sosAlertsTable.createdAt));
  res.json(alerts.map((alert) => sosResponse(alert, policy)));
});

router.post("/emergency/sos", async (req, res) => {
  const body = TriggerSosBody.parse(req.body);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const [alert] = await db.insert(sosAlertsTable).values({
    id: `sos-${randomUUID()}`,
    status: body.drill
      ? `Drill triggered · Ack in ${policy.sosAcknowledgementMinutes} min`
      : `Triggered · Control Room alerted · Ack in ${policy.sosAcknowledgementMinutes} min`,
    employeeName: body.employeeName,
    location: body.location,
    drill: body.drill ?? false,
    triggeredBy: operatorFor(req),
  }).returning();
  res.status(201).json(sosResponse(alert, policy));
});

router.get("/team/guards", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (_req, res) => {
  const records = await db.select().from(guardsTable).orderBy(asc(guardsTable.id));
  res.json(records.map(guardResponse));
});

router.post("/team/guards/:id/check-in", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const { id } = CheckInGuardParams.parse(req.params);
  const timestamp = now();
  const [guard] = await db.update(guardsTable).set({
    status: "On duty",
    lastSeenAt: timestamp,
    checkedInAt: timestamp,
    checkedInBy: operatorFor(req),
    updatedAt: timestamp,
  }).where(eq(guardsTable.id, id)).returning();
  if (!guard) {
    res.status(404).json({ error: "Guard not found" });
    return;
  }
  res.json(guardResponse(guard));
});

router.get("/checklist/today", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (_req, res) => {
  const records = await db.select().from(checklistItemsTable)
    .orderBy(asc(checklistItemsTable.id));
  res.json(records.map(checklistResponse));
});

router.patch("/checklist/:id", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const { id } = UpdateChecklistItemParams.parse(req.params);
  const body = UpdateChecklistItemBody.parse(req.body);
  const timestamp = now();
  const [item] = await db.update(checklistItemsTable).set({
    completed: body.completed,
    completedAt: body.completed ? timestamp : null,
    completedBy: body.completed ? operatorFor(req) : null,
    updatedAt: timestamp,
  }).where(eq(checklistItemsTable.id, id)).returning();
  if (!item) {
    res.status(404).json({ error: "Checklist item not found" });
    return;
  }
  res.json(checklistResponse(item));
});

router.get("/contacts", (_req, res) => {
  res.json(contacts);
});

router.get("/site-report/today", async (_req, res) => {
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  res.json({
    ...siteReport,
    site: policyRecord?.siteName ?? siteReport.site,
  });
});

router.get("/tracking/field-officers", requireRole("Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (req, res) => {
  const query = GetFieldOfficerTrackingQueryParams.parse(req.query);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const trackingWindow = `${policy.tracking.startTime}–${policy.tracking.endTime}`;
  if (!policy.tracking.enabled || !isWithinDutyWindow(now(), policy.tracking.startTime, policy.tracking.endTime, policy.timezone)) {
    res.json([]);
    return;
  }
  if (req.workforceAccess?.role === "Field Officer" && !req.workforceAccess.fieldOfficerId) {
    res.json([]);
    return;
  }
  const assignedOfficerId = req.workforceAccess?.role === "Field Officer"
    ? req.workforceAccess.fieldOfficerId
    : undefined;
  const filtered = fieldOfficers.filter((officer) =>
    (!assignedOfficerId || officer.id === assignedOfficerId) &&
    (!query.city || officer.city === query.city) &&
    (!query.dutyStatus ||
      (query.dutyStatus === "on_duty" && officer.dutyStatus === "On duty") ||
      (query.dutyStatus === "off_duty" && officer.dutyStatus !== "On duty")),
  ).map((officer) => ({
    id: officer.id,
    name: officer.name,
    city: officer.city,
    dutyStatus: officer.dutyStatus,
    location: officer.location,
    lastUpdate: officer.lastUpdate,
    coordinates: officer.coordinates,
    trackingWindow,
    heartbeatMinutes: policy.tracking.heartbeatMinutes,
  }));
  res.json(filtered);
});

router.get("/employee-submissions", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const query = GetEmployeeSubmissionsQueryParams.parse(req.query);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const records = await db.select().from(employeeSubmissionsTable)
    .orderBy(desc(employeeSubmissionsTable.submittedAt));
  res.json(records
    .filter((submission) => !query.status || submission.status === query.status)
    .map((submission) => submissionResponse(submission, policy, req.workforceAccess)));
});

router.post("/employee-submissions", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const body = SubmitEmployeeDetailsBody.parse(req.body);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const [record] = await db.insert(employeeSubmissionsTable).values({
    id: `sub-${randomUUID()}`,
    name: body.name,
    phone: body.phone,
    city: body.city,
    submittedBy: operatorFor(req),
    status: "Submitted",
    documents: 0,
    note: body.note ?? null,
  }).returning();
  res.status(201).json(submissionResponse(record, policy, req.workforceAccess));
});

router.patch("/employee-submissions/:id/decision", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const { id } = DecideEmployeeSubmissionParams.parse(req.params);
  const body = DecideEmployeeSubmissionBody.parse(req.body);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const existing = await db.select().from(employeeSubmissionsTable)
    .where(eq(employeeSubmissionsTable.id, id));
  if (!existing[0]) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  const timestamp = now();
  const [submission] = await db.update(employeeSubmissionsTable).set({
    status: body.decision === "accepted" ? "Accepted" : body.decision === "rejected" ? "Rejected" : "Sent Back",
    note: body.note ?? existing[0].note,
    decisionAt: timestamp,
    decisionBy: operatorFor(req),
    updatedAt: timestamp,
  }).where(eq(employeeSubmissionsTable.id, id)).returning();
  res.json(submissionResponse(submission, policy, req.workforceAccess));
});

router.get("/payslips", (_req, res) => {
  res.json(payslips);
});

router.get("/requests", async (_req, res) => {
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const records = await db.select().from(requestsTable)
    .orderBy(desc(requestsTable.submittedAt));
  res.json(records.map((record) => requestResponse(record, policy)));
});

async function createRequest(
  req: Request,
  res: Response,
  type: string,
  summary: string,
  policy: PolicyInput,
) {
  const [record] = await db.insert(requestsTable).values({
    id: `${type.toLowerCase().replaceAll(" ", "-")}-${randomUUID()}`,
    type,
    summary,
    status: "Pending review",
    submittedBy: operatorFor(req),
  }).returning();
  res.status(201).json(requestResponse(record, policy));
}

router.post("/requests/leave", async (req, res) => {
  const body = CreateLeaveRequestBody.parse(req.body);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  await createRequest(req, res, "Leave request", `${body.from} to ${body.to} · ${body.reason}`, policy);
});

router.post("/requests/salary-advance", async (req, res) => {
  const body = CreateSalaryAdvanceRequestBody.parse(req.body);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  if (!policy.requests.salaryAdvanceEnabled) {
    res.status(422).json({ error: "Salary advances are currently disabled by operating policy." });
    return;
  }
  if (body.amount > policy.requests.salaryAdvanceMaxAmount) {
    res.status(422).json({ error: `Salary advances are capped at ₹${policy.requests.salaryAdvanceMaxAmount.toLocaleString("en-IN")}.` });
    return;
  }
  await createRequest(req, res, "Salary advance", `₹${body.amount.toLocaleString("en-IN")} · ${body.reason}`, policy);
});

router.post("/requests/bills", async (req, res) => {
  const body = CreateBillSubmissionBody.parse(req.body);
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  if (!policy.requests.billSubmissionEnabled) {
    res.status(422).json({ error: "Bill submissions are currently disabled by operating policy." });
    return;
  }
  if (body.amount > policy.requests.billMaxAmount) {
    res.status(422).json({ error: `Bill submissions are capped at ₹${policy.requests.billMaxAmount.toLocaleString("en-IN")}.` });
    return;
  }
  if (policy.requests.billReceiptRequired && !body.receiptReference?.trim()) {
    res.status(422).json({ error: "A receipt reference is required by the active bill policy." });
    return;
  }
  await createRequest(req, res, "Bill submission", `${body.category} · ${body.vendor} · ₹${body.amount.toLocaleString("en-IN")}`, policy);
});

export default router;