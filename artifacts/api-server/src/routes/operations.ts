import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { clerkClient } from "@clerk/express";
import { asc, desc, and, eq, notInArray, or, sql } from "drizzle-orm";
import {
  db,
  attendanceRecordsTable,
  auditEventsTable,
  checklistItemsTable,
  employeeSubmissionsTable,
  guardsTable,
  requestsTable,
  sosAlertsTable,
  operatingPoliciesTable,
  operatingPolicyRevisionsTable,
  workforceItemsTable,
  attendanceEventsTable,
  locationHeartbeatsTable,
  patrolCheckpointsTable,
  patrolScansTable,
  incidentRecordsTable,
  incidentEventsTable,
  rosterAssignmentsTable,
  complianceRecordsTable,
  operationalReportsTable,
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
  GetWorkforceWorkbenchQueryParams,
  CreateWorkforceItemBody,
  UpdateWorkforceItemParams,
  UpdateWorkforceItemBody,
  TransitionWorkforceItemParams,
  TransitionWorkforceItemBody,
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
  siteLatitude: number;
  siteLongitude: number;
  city: string;
  cityLatitude: number;
  cityLongitude: number;
  cityRadiusMeters: number;
  attendanceGraceMinutes: number;
  maxLocationAccuracyMeters: number;
  offlineAttendanceEnabled: boolean;
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
  siteLatitude: 12.9716,
  siteLongitude: 77.7500,
  city: "Bengaluru",
  cityLatitude: 12.9716,
  cityLongitude: 77.5946,
  cityRadiusMeters: 50000,
  attendanceGraceMinutes: 15,
  maxLocationAccuracyMeters: 100,
  offlineAttendanceEnabled: true,
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
    siteLatitude: record.siteLatitude,
    siteLongitude: record.siteLongitude,
    city: record.city,
    cityLatitude: record.cityLatitude,
    cityLongitude: record.cityLongitude,
    cityRadiusMeters: record.cityRadiusMeters,
    attendanceGraceMinutes: record.attendanceGraceMinutes,
    maxLocationAccuracyMeters: record.maxLocationAccuracyMeters,
    offlineAttendanceEnabled: record.offlineAttendanceEnabled,
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
    siteLatitude: response.siteLatitude,
    siteLongitude: response.siteLongitude,
    city: response.city,
    cityLatitude: response.cityLatitude,
    cityLongitude: response.cityLongitude,
    cityRadiusMeters: response.cityRadiusMeters,
    attendanceGraceMinutes: response.attendanceGraceMinutes,
    maxLocationAccuracyMeters: response.maxLocationAccuracyMeters,
    offlineAttendanceEnabled: response.offlineAttendanceEnabled,
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
      siteLatitude: policy.siteLatitude,
      siteLongitude: policy.siteLongitude,
      city: policy.city,
      cityLatitude: policy.cityLatitude,
      cityLongitude: policy.cityLongitude,
      cityRadiusMeters: policy.cityRadiusMeters,
      attendanceGraceMinutes: policy.attendanceGraceMinutes,
      maxLocationAccuracyMeters: policy.maxLocationAccuracyMeters,
      offlineAttendanceEnabled: policy.offlineAttendanceEnabled,
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
  const nextSnapshots = policySectionSnapshots({
    ...defaultPolicy,
    ...next,
    siteLatitude: next.siteLatitude ?? previous.siteLatitude,
    siteLongitude: next.siteLongitude ?? previous.siteLongitude,
    city: next.city ?? previous.city,
    cityLatitude: next.cityLatitude ?? previous.cityLatitude,
    cityLongitude: next.cityLongitude ?? previous.cityLongitude,
    cityRadiusMeters: next.cityRadiusMeters ?? previous.cityRadiusMeters,
    attendanceGraceMinutes: next.attendanceGraceMinutes ?? previous.attendanceGraceMinutes,
    maxLocationAccuracyMeters: next.maxLocationAccuracyMeters ?? previous.maxLocationAccuracyMeters,
    offlineAttendanceEnabled: next.offlineAttendanceEnabled ?? previous.offlineAttendanceEnabled,
  });

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
    punchInVerification: record.punchInVerification,
    punchOutVerification: record.punchOutVerification,
    punchInAccuracyMeters: record.punchInAccuracyMeters,
    punchOutAccuracyMeters: record.punchOutAccuracyMeters,
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

function haversineMeters(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
) {
  const radius = 6_371_000;
  const latDelta = (targetLatitude - latitude) * Math.PI / 180;
  const lngDelta = (targetLongitude - longitude) * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lat2 = targetLatitude * Math.PI / 180;
  const value = Math.sin(latDelta / 2) ** 2
    + Math.sin(lngDelta / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function heartbeatResponse(record: typeof locationHeartbeatsTable.$inferSelect, policy: PolicyInput) {
  const stale = Date.now() - record.capturedAt.getTime() > policy.tracking.offlineAfterMinutes * 60_000;
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    city: record.city,
    site: record.site,
    dutyStatus: stale ? "Offline" : record.dutyStatus,
    latitude: record.latitude,
    longitude: record.longitude,
    accuracyMeters: record.accuracyMeters,
    capturedAt: record.capturedAt.toISOString(),
    receivedAt: record.receivedAt.toISOString(),
    stale,
  };
}

function checkpointResponse(record: typeof patrolCheckpointsTable.$inferSelect) {
  return {
    id: record.id,
    site: record.site,
    name: record.name,
    qrToken: record.qrToken,
    sequence: record.sequence,
    latitude: record.latitude,
    longitude: record.longitude,
    radiusMeters: record.radiusMeters,
    active: record.active,
  };
}

function patrolScanResponse(record: typeof patrolScansTable.$inferSelect) {
  return {
    id: record.id,
    checkpointId: record.checkpointId,
    roundId: record.roundId,
    scannedBy: record.scannedBy,
    scannedAt: record.scannedAt.toISOString(),
    latitude: record.latitude,
    longitude: record.longitude,
    accuracyMeters: record.accuracyMeters,
    status: record.status,
    note: record.note,
  };
}

function incidentResponse(record: typeof incidentRecordsTable.$inferSelect) {
  return {
    id: record.id,
    category: record.category,
    severity: record.severity,
    status: record.status,
    title: record.title,
    narrative: record.narrative,
    site: record.site,
    affectedPeople: record.affectedPeople,
    affectedAssets: record.affectedAssets,
    latitude: record.latitude,
    longitude: record.longitude,
    reportedAt: record.reportedAt.toISOString(),
    dueAt: record.dueAt?.toISOString() ?? null,
    assignedTo: record.assignedTo,
    createdBy: record.createdBy,
  };
}

function rosterResponse(record: typeof rosterAssignmentsTable.$inferSelect) {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    site: record.site,
    post: record.post,
    shift: record.shift,
    rosterDate: record.rosterDate,
    status: record.status,
    acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
    replacementFor: record.replacementFor,
    lockedAt: record.lockedAt?.toISOString() ?? null,
    conflictReason: record.conflictReason,
  };
}

function complianceResponse(record: typeof complianceRecordsTable.$inferSelect) {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    kind: record.kind,
    reference: record.reference,
    status: record.status,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
  };
}

function reportResponse(record: typeof operationalReportsTable.$inferSelect) {
  return {
    id: record.id,
    reportDate: record.reportDate,
    site: record.site,
    status: record.status,
    submittedBy: record.submittedBy,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    data: record.data,
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
      siteLatitude: defaultPolicy.siteLatitude,
      siteLongitude: defaultPolicy.siteLongitude,
      city: defaultPolicy.city,
      cityLatitude: defaultPolicy.cityLatitude,
      cityLongitude: defaultPolicy.cityLongitude,
      cityRadiusMeters: defaultPolicy.cityRadiusMeters,
      attendanceGraceMinutes: defaultPolicy.attendanceGraceMinutes,
      maxLocationAccuracyMeters: defaultPolicy.maxLocationAccuracyMeters,
      offlineAttendanceEnabled: defaultPolicy.offlineAttendanceEnabled,
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

  await db.insert(locationHeartbeatsTable).values([
    {
      id: "heartbeat-fo-001",
      employeeId: "fo-001",
      employeeName: "Rahul Verma",
      role: "Field Officer",
      city: policy.city,
      site: policy.siteName,
      dutyStatus: "On duty",
      latitude: policy.cityLatitude,
      longitude: policy.cityLongitude,
      accuracyMeters: 12,
      capturedAt: new Date(currentTime - 2 * 60_000),
      source: "seeded-operational-record",
    },
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

  const seedItems = [
    {
      id: "wf-roster-001",
      kind: "roster",
      status: "Published",
      title: "Morning roster · Northgate Business Park",
      description: "Published shift plan with post coverage and relief ownership.",
      priority: "normal",
      site: policy.siteName,
      city: "Bengaluru",
      data: { shift: "Morning", headcount: 18, posts: 18, locked: true, reliefPool: 2 },
    },
    {
      id: "wf-coverage-001",
      kind: "coverage",
      status: "At risk",
      title: "Loading bay post needs relief",
      description: "One absence is creating a gap in the active roster.",
      priority: "high",
      site: policy.siteName,
      city: "Bengaluru",
      data: { post: "Loading Bay", scheduled: 3, present: 2, replacementRequired: true },
    },
    {
      id: "wf-credential-001",
      kind: "credential",
      status: "Expiring",
      title: "Guard licence renewal · Rakesh Patel",
      description: "Licence expires within the configured compliance window.",
      priority: "high",
      site: policy.siteName,
      city: "Bengaluru",
      data: { employee: "Rakesh Patel", credential: "PSARA licence", expiresOn: offsetDate(today, 18), verification: "Pending" },
    },
    {
      id: "wf-task-001",
      kind: "task",
      status: "In progress",
      title: "Perimeter inspection evidence",
      description: "Capture a live image and note exceptions at the east perimeter.",
      priority: "normal",
      site: policy.siteName,
      city: "Bengaluru",
      data: { assignee: "Vikram Singh", evidenceRequired: true, evidenceType: "live-image", checklist: "East perimeter" },
    },
    {
      id: "wf-incident-001",
      kind: "incident",
      status: "Investigating",
      title: "Unauthorised access attempt · Gate A",
      description: "Control Room has assigned an investigator and preserved the event trail.",
      priority: "critical",
      site: policy.siteName,
      city: "Bengaluru",
      data: { severity: "High", reportedBy: "Gate A", investigationOwner: "Control Room", evidenceCount: 2 },
    },
    {
      id: "wf-sos-001",
      kind: "sos",
      status: "Acknowledged",
      title: "SOS drill · Parking P2",
      description: "Acknowledged alert with dispatch and escalation timers recorded.",
      priority: "high",
      site: policy.siteName,
      city: "Bengaluru",
      data: { triggeredBy: "Sanjay Rao", acknowledgedAt: atTime(today, "09:12"), dispatchId: "dispatch-001", drill: true },
    },
    {
      id: "wf-handover-001",
      kind: "handover",
      status: "Pending sign-off",
      title: "Evening shift handover",
      description: "Incoming Supervisor must accept open posts, keys and exceptions.",
      priority: "normal",
      site: policy.siteName,
      city: "Bengaluru",
      data: { outgoing: "Amit Kulkarni", incoming: "Meera Nair", openExceptions: 2, assets: 14 },
    },
    {
      id: "wf-leave-001",
      kind: "leave",
      status: "Pending approval",
      title: "Leave request · Priya Menon",
      description: "Leave request is waiting for the configured approval path.",
      priority: "normal",
      site: policy.siteName,
      city: "Bengaluru",
      data: { employee: "Priya Menon", from: offsetDate(today, 3), to: offsetDate(today, 5), type: "Annual" },
    },
    {
      id: "wf-payroll-001",
      kind: "payroll_reconciliation",
      status: "Needs review",
      title: "August payroll reconciliation",
      description: "Three attendance exceptions need resolution before payroll release.",
      priority: "high",
      site: policy.siteName,
      city: "Bengaluru",
      data: { period: "August 2026", totalEmployees: 42, matched: 39, exceptions: 3, locked: false },
    },
    {
      id: "wf-client-001",
      kind: "client_portal",
      status: "Published",
      title: "Client service report · Northgate",
      description: "Read-only client view of coverage, attendance, patrol and open issues.",
      priority: "normal",
      site: policy.siteName,
      city: "Bengaluru",
      data: { coverage: 92, attendance: 88, patrolCompletion: 96, openIssues: 3, visibility: "client" },
    },
  ] as const;
  await db.insert(workforceItemsTable).values(seedItems.map((item) => ({
    ...item,
    createdBy: "system",
    data: item.data as Record<string, unknown>,
  }))).onConflictDoNothing();
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

function auditSummary(item: { kind: string; title: string }, action: string, actorId: string, note?: string) {
  return {
    id: randomUUID(),
    entityType: "workforce_item",
    entityId: item.title,
    action,
    actorId,
    summary: note?.trim() || `${action} · ${item.kind} · ${item.title}`,
    metadata: { kind: item.kind },
  };
}

function isVisibleToAccess(item: typeof workforceItemsTable.$inferSelect, access: WorkforceAccess) {
  return ["Management", "Control Room"].includes(access.role)
    || !item.site
    || item.site === access.siteName;
}

function workbenchMetrics(items: Array<typeof workforceItemsTable.$inferSelect>) {
  const count = (predicate: (item: typeof workforceItemsTable.$inferSelect) => boolean) =>
    items.filter(predicate).length;
  const open = (item: typeof workforceItemsTable.$inferSelect) =>
    !["Completed", "Closed", "Approved", "Published", "Resolved", "Cancelled"].includes(item.status);
  return {
    openPosts: count((item) => ["roster", "coverage", "replacement"].includes(item.kind) && open(item)),
    atRiskPosts: count((item) => item.status.toLowerCase().includes("risk") || item.priority === "critical"),
    noShows: count((item) => item.kind === "attendance_exception" && item.status !== "Resolved"),
    pendingApprovals: count((item) => item.status.toLowerCase().includes("pending") || item.status.toLowerCase().includes("review")),
    expiringCredentials: count((item) => item.kind === "credential" && item.status !== "Verified"),
    openIncidents: count((item) => ["incident", "event"].includes(item.kind) && open(item)),
    activeSos: count((item) => item.kind === "sos" && !["Closed", "Resolved", "Cancelled"].includes(item.status)),
    overdueTasks: count((item) => Boolean(item.kind === "task" && item.dueAt && item.dueAt.getTime() < Date.now() && open(item))),
    unresolvedAttendance: count((item) => ["attendance_exception", "attendance_correction", "late_alert"].includes(item.kind) && open(item)),
    coverage: 92,
    attendance: 88,
    patrolCompletion: 96,
  };
}

router.get("/workforce/workbench", async (req, res) => {
  const access = req.workforceAccess;
  if (!access) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const query = GetWorkforceWorkbenchQueryParams.parse(req.query);
  const rows = await db.select().from(workforceItemsTable).orderBy(desc(workforceItemsTable.updatedAt));
  const items = rows.filter((item) =>
    isVisibleToAccess(item, access)
    && (!query.kind || item.kind === query.kind)
    && (!query.status || item.status === query.status),
  );
  const audit = await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.createdAt)).limit(100);
  res.json({ items, audit, metrics: workbenchMetrics(items) });
});

router.post("/workforce/items", requireRole("Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (req, res) => {
  const access = req.workforceAccess;
  const body = CreateWorkforceItemBody.parse(req.body);
  if (!access) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const id = `wf-${randomUUID()}`;
  const [item] = await db.insert(workforceItemsTable).values({
    id,
    kind: body.kind,
    status: body.status ?? "Open",
    title: body.title.trim(),
    description: body.description?.trim() ?? "",
    priority: body.priority ?? "normal",
    site: body.site?.trim() || access.siteName,
    city: body.city?.trim() || null,
    ownerId: body.ownerId ?? access.userId,
    assigneeId: body.assigneeId ?? null,
    dueAt: body.dueAt ? new Date(body.dueAt) : null,
    data: body.data ?? {},
    createdBy: access.userId,
  }).returning();
  if (!item) {
    res.status(500).json({ error: "The workforce item could not be created." });
    return;
  }
  await db.insert(auditEventsTable).values(auditSummary(item, "Created", access.userId));
  res.status(201).json(item);
});

router.patch("/workforce/items/:id", requireRole("Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (req, res) => {
  const access = req.workforceAccess;
  const { id } = UpdateWorkforceItemParams.parse(req.params);
  const body = UpdateWorkforceItemBody.parse(req.body);
  if (!access) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [current] = await db.select().from(workforceItemsTable).where(eq(workforceItemsTable.id, id)).limit(1);
  if (!current || !isVisibleToAccess(current, access)) {
    res.status(404).json({ error: "Workforce item not found." });
    return;
  }
  const [item] = await db.update(workforceItemsTable).set({
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.title !== undefined ? { title: body.title.trim() } : {}),
    ...(body.description !== undefined ? { description: body.description.trim() } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.site !== undefined ? { site: body.site } : {}),
    ...(body.city !== undefined ? { city: body.city } : {}),
    ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
    ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
    ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
    ...(body.data !== undefined ? { data: body.data } : {}),
  }).where(eq(workforceItemsTable.id, id)).returning();
  if (!item) {
    res.status(404).json({ error: "Workforce item not found." });
    return;
  }
  await db.insert(auditEventsTable).values(auditSummary(item, "Updated", access.userId));
  res.json(item);
});

router.post("/workforce/items/:id/transition", requireRole("Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (req, res) => {
  const access = req.workforceAccess;
  const { id } = TransitionWorkforceItemParams.parse(req.params);
  const body = TransitionWorkforceItemBody.parse(req.body);
  if (!access) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [current] = await db.select().from(workforceItemsTable).where(eq(workforceItemsTable.id, id)).limit(1);
  if (!current || !isVisibleToAccess(current, access)) {
    res.status(404).json({ error: "Workforce item not found." });
    return;
  }
  const closed = ["Completed", "Closed", "Approved", "Published", "Resolved", "Cancelled"].includes(body.status);
  const [item] = await db.update(workforceItemsTable).set({
    status: body.status,
    closedAt: closed ? new Date() : null,
  }).where(eq(workforceItemsTable.id, id)).returning();
  if (!item) {
    res.status(404).json({ error: "Workforce item not found." });
    return;
  }
  await db.insert(auditEventsTable).values(auditSummary(item, `Transitioned to ${body.status}`, access.userId, body.note));
  res.json(item);
});

router.get("/workforce/audit", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (_req, res) => {
  res.json(await db.select().from(auditEventsTable).orderBy(desc(auditEventsTable.createdAt)).limit(100));
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
    const nextSnapshots = policySectionSnapshots({
      ...defaultPolicy,
      ...body,
      siteLatitude: body.siteLatitude ?? existing.siteLatitude,
      siteLongitude: body.siteLongitude ?? existing.siteLongitude,
      city: body.city ?? existing.city,
      cityLatitude: body.cityLatitude ?? existing.cityLatitude,
      cityLongitude: body.cityLongitude ?? existing.cityLongitude,
      cityRadiusMeters: body.cityRadiusMeters ?? existing.cityRadiusMeters,
      attendanceGraceMinutes: body.attendanceGraceMinutes ?? existing.attendanceGraceMinutes,
      maxLocationAccuracyMeters: body.maxLocationAccuracyMeters ?? existing.maxLocationAccuracyMeters,
      offlineAttendanceEnabled: body.offlineAttendanceEnabled ?? existing.offlineAttendanceEnabled,
    });
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

router.get("/dashboard/summary", async (_req, res) => {
  const [guards, attendance, scans, incidents, items, heartbeats] = await Promise.all([
    db.select().from(guardsTable),
    db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.attendanceDate, todayKey())),
    db.select().from(patrolScansTable),
    db.select().from(incidentRecordsTable),
    db.select().from(workforceItemsTable),
    db.select().from(locationHeartbeatsTable).orderBy(desc(locationHeartbeatsTable.capturedAt)),
  ]);
  const latestOfficers = new Map<string, typeof heartbeats[number]>();
  for (const heartbeat of heartbeats) {
    const key = heartbeat.employeeId ?? heartbeat.employeeName;
    if (!latestOfficers.has(key)) latestOfficers.set(key, heartbeat);
  }
  const presentGuards = guards.filter((guard) => ["On duty", "Present", "Checked in"].includes(guard.status)).length;
  const attendancePercent = attendance.length === 0
    ? 0
    : Math.round(attendance.filter((record) => record.status !== "Absent").length / attendance.length * 100);
  const patrolPercent = scans.length === 0
    ? 0
    : Math.round(scans.filter((scan) => scan.status === "Verified").length / scans.length * 100);
  const activeIncidents = incidents.filter((incident) => !["Closed"].includes(incident.status)).length;
  const openApprovals = items.filter((item) => /pending|review|approval/i.test(item.status)).length;
  const liveOfficers = [...latestOfficers.values()].filter((heartbeat) =>
    Date.now() - heartbeat.capturedAt.getTime() <= 15 * 60_000,
  ).length;
  res.json({
    coverage: guards.length ? Math.round(presentGuards / guards.length * 100) : 0,
    attendance: attendancePercent,
    patrol: patrolPercent,
    incidents: activeIncidents,
    openApprovals,
    fieldOfficers: liveOfficers,
  });
});

router.get("/activity", async (_req, res) => {
  const events = await db.select().from(auditEventsTable)
    .orderBy(desc(auditEventsTable.createdAt))
    .limit(20);
  res.json(events.map((event) => ({
    id: event.id,
    title: event.action,
    detail: event.summary,
    time: lastSeenValue(event.createdAt),
    tone: /reject|outside|late|sos|incident/i.test(event.action) ? "danger" : /pending|review/i.test(event.action) ? "warning" : "info",
  })));
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
  const idempotencyKey = body.idempotencyKey ?? `legacy-${randomUUID()}`;
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const [existingEvent] = await db.select().from(attendanceEventsTable)
    .where(eq(attendanceEventsTable.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existingEvent) {
    const [existingRecord] = await db.select().from(attendanceRecordsTable)
      .where(eq(attendanceRecordsTable.id, existingEvent.attendanceId));
    if (existingRecord) {
      res.json(attendanceResponse(existingRecord, policy, req.workforceAccess));
      return;
    }
  }
  const attendanceDate = todayKey();
  const [record] = await db.select().from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.attendanceDate, attendanceDate));
  if (!record) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }
  const timestamp = now();
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : timestamp;
  const hasCoordinates = typeof body.latitude === "number" && typeof body.longitude === "number";
  const distance = hasCoordinates
    ? haversineMeters(body.latitude!, body.longitude!, policy.siteLatitude, policy.siteLongitude)
    : null;
  const accuracyTooLow = typeof body.accuracyMeters === "number"
    && body.accuracyMeters > policy.maxLocationAccuracyMeters;
  const staleCapture = timestamp.getTime() - capturedAt.getTime() > 24 * 60 * 60_000
    || capturedAt.getTime() - timestamp.getTime() > 5 * 60_000;
  const insideGeofence = distance !== null && distance <= policy.geofenceRadiusMeters;
  const supervisorOverride = body.source === "supervisor";
  const verified = supervisorOverride || (
    hasCoordinates && insideGeofence && !accuracyTooLow && !staleCapture
  );
  if (policy.geofenceRequireInside && !verified) {
    const reason = !hasCoordinates
      ? `A live latitude and longitude are required before checking the ${policy.geofenceRadiusMeters}m site geofence.`
      : accuracyTooLow
        ? `Location accuracy must be ${policy.maxLocationAccuracyMeters}m or better.`
        : staleCapture
          ? "The captured location is stale and must be recorded again."
          : `Attendance can only be recorded inside the ${policy.geofenceRadiusMeters}m site geofence.`;
    await db.insert(attendanceEventsTable).values({
      id: `attendance-event-${randomUUID()}`,
      attendanceId: record.id,
      employeeId: req.workforceAccess?.fieldOfficerId ?? req.workforceAccess?.userId ?? null,
      employeeName: record.employeeName,
      action: body.action,
      status: "Rejected",
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      accuracyMeters: body.accuracyMeters ?? null,
      capturedAt,
      source: body.source ?? "online",
      idempotencyKey,
      distanceFromSiteMeters: distance,
      verification: "outside_geofence",
      reason,
      actor: operatorFor(req),
    });
    res.status(422).json({ error: reason, distanceFromSiteMeters: distance, verification: "Rejected" });
    return;
  }
  const activeShift = policy.shifts.find((shift) => {
    const minutes = timestampMinutes(timestamp);
    const start = timestampMinutesFromString(shift.startTime);
    const end = timestampMinutesFromString(shift.endTime);
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }) ?? policy.shifts[0];
  const [updated] = await db.update(attendanceRecordsTable)
    .set({
      ...(body.action === "in"
        ? {
            punchInAt: timestamp,
            punchInLatitude: body.latitude ?? null,
            punchInLongitude: body.longitude ?? null,
            punchInAccuracyMeters: body.accuracyMeters ?? null,
            punchInCapturedAt: capturedAt,
            punchInReceivedAt: timestamp,
            punchInSource: body.source ?? "online",
            punchInVerification: verified ? "Verified" : "Manual override",
            status: "On duty",
            shift: activeShift ? `${activeShift.name} · ${activeShift.startTime}–${activeShift.endTime}` : record.shift,
          }
        : {
            punchOutAt: timestamp,
            punchOutLatitude: body.latitude ?? null,
            punchOutLongitude: body.longitude ?? null,
            punchOutAccuracyMeters: body.accuracyMeters ?? null,
            punchOutCapturedAt: capturedAt,
            punchOutReceivedAt: timestamp,
            punchOutSource: body.source ?? "online",
            punchOutVerification: verified ? "Verified" : "Manual override",
            status: "Shift complete",
          }),
      site: policy.siteName,
      geofence: policy.geofenceRequireInside
        ? `${verified ? "Inside" : "Manual override"} ${policy.siteName} geofence (${policy.geofenceRadiusMeters}m)${distance === null ? "" : ` · ${Math.round(distance)}m from site`}`
        : body.location,
      updatedAt: timestamp,
    })
    .where(eq(attendanceRecordsTable.id, record.id))
    .returning();
  await db.insert(attendanceEventsTable).values({
    id: `attendance-event-${randomUUID()}`,
    attendanceId: record.id,
    employeeId: req.workforceAccess?.fieldOfficerId ?? req.workforceAccess?.userId ?? null,
    employeeName: record.employeeName,
    action: body.action,
    status: "Accepted",
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    accuracyMeters: body.accuracyMeters ?? null,
    capturedAt,
    source: body.source ?? "online",
    idempotencyKey,
    distanceFromSiteMeters: distance,
    verification: verified ? "Verified" : "Manual override",
    actor: operatorFor(req),
  });
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

router.patch("/emergency/sos/:id/status", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const status = (req.body as { status?: string }).status;
  const allowed = ["Triggered", "Delivered", "Acknowledged", "Dispatched", "Safe", "Escalated", "Closed"];
  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: "Invalid SOS lifecycle status" });
    return;
  }
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const [alert] = await db.update(sosAlertsTable).set({ status })
    .where(eq(sosAlertsTable.id, String(req.params.id))).returning();
  if (!alert) {
    res.status(404).json({ error: "SOS alert not found" });
    return;
  }
  await db.insert(auditEventsTable).values({
    id: randomUUID(),
    entityType: "sos",
    entityId: alert.id,
    action: `sos_${status.toLowerCase()}`,
    actorId: operatorFor(req),
    summary: `SOS transitioned to ${status}`,
    metadata: { note: (req.body as { note?: string }).note ?? null },
  });
  res.json(sosResponse(alert, policy));
});

router.post("/attendance/corrections", requireRole("Guard", "Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const body = req.body as {
    attendanceId?: string; action?: string; correctedAt?: string; reason?: string; evidence?: Record<string, unknown>;
  };
  if (!body.attendanceId || !["in", "out"].includes(body.action ?? "") || !body.reason || body.reason.trim().length < 5) {
    res.status(400).json({ error: "attendanceId, action and a reason of at least 5 characters are required" });
    return;
  }
  const action = body.action as "in" | "out";
  const [attendance] = await db.select().from(attendanceRecordsTable)
    .where(eq(attendanceRecordsTable.id, body.attendanceId)).limit(1);
  if (!attendance) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }
  const requestedAt = now();
  const [event] = await db.insert(attendanceEventsTable).values({
    id: `attendance-correction-${randomUUID()}`,
    attendanceId: attendance.id,
    employeeId: attendance.employeeId,
    employeeName: attendance.employeeName,
    action,
    status: "Pending approval",
    capturedAt: body.correctedAt ? new Date(body.correctedAt) : null,
    source: "supervisor",
    idempotencyKey: `correction-${randomUUID()}`,
    verification: "Correction requested",
    reason: body.reason.trim(),
    evidence: body.evidence ?? {},
    actor: operatorFor(req),
    receivedAt: requestedAt,
  }).returning();
  await db.update(attendanceRecordsTable).set({ correctionStatus: "Pending approval", updatedAt: requestedAt })
    .where(eq(attendanceRecordsTable.id, attendance.id));
  res.status(201).json({
    id: event.id,
    attendanceId: event.attendanceId,
    action: event.action,
    status: event.status,
    reason: event.reason,
    requestedBy: event.actor,
    requestedAt: event.createdAt.toISOString(),
  });
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
  const [guards, attendance, scans, incidents] = await Promise.all([
    db.select().from(guardsTable),
    db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.attendanceDate, todayKey())),
    db.select().from(patrolScansTable),
    db.select().from(incidentRecordsTable),
  ]);
  const coverage = guards.length ? Math.round(guards.filter((guard) => guard.status === "On duty").length / guards.length * 100) : 0;
  const attendancePercent = attendance.length ? Math.round(attendance.filter((record) => record.status !== "Absent").length / attendance.length * 100) : 0;
  const patrolCompletion = scans.length ? Math.round(scans.filter((scan) => scan.status === "Verified").length / scans.length * 100) : 0;
  res.json({
    date: todayKey(),
    site: policyRecord?.siteName ?? defaultPolicy.siteName,
    coverage,
    attendance: attendancePercent,
    patrolCompletion,
    openIssues: incidents.filter((incident) => incident.status !== "Closed").length,
    status: "Live · compiled from persisted events",
  });
});

router.post("/tracking/heartbeat", requireRole("Field Officer"), async (req, res) => {
  const body = req.body as {
    employeeId?: string;
    employeeName?: string;
    city?: string;
    site?: string;
    dutyStatus?: string;
    latitude?: number;
    longitude?: number;
    accuracyMeters?: number;
    capturedAt?: string;
    source?: string;
    deviceId?: string;
  };
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  if (!body.employeeName || typeof body.latitude !== "number" || typeof body.longitude !== "number" || !body.capturedAt || !body.city || !body.dutyStatus) {
    res.status(400).json({ error: "employeeName, city, dutyStatus, coordinates and capturedAt are required" });
    return;
  }
  if (!policy.tracking.enabled || !isWithinDutyWindow(now(), policy.tracking.startTime, policy.tracking.endTime, policy.timezone)) {
    res.status(422).json({ error: `Tracking is only accepted during ${policy.tracking.startTime}–${policy.tracking.endTime} (${policy.timezone}).` });
    return;
  }
  const capturedAt = new Date(body.capturedAt);
  const accuracyTooLow = typeof body.accuracyMeters === "number"
    && body.accuracyMeters > policy.maxLocationAccuracyMeters;
  const cityDistance = body.city === policy.city
    ? haversineMeters(body.latitude, body.longitude, policy.cityLatitude, policy.cityLongitude)
    : null;
  if (accuracyTooLow || cityDistance !== null && cityDistance > policy.cityRadiusMeters) {
    res.status(422).json({
      error: accuracyTooLow
        ? `Location accuracy must be ${policy.maxLocationAccuracyMeters}m or better.`
        : `Location is outside the authorized ${body.city} duty area.`,
      distanceFromCityMeters: cityDistance,
    });
    return;
  }
  const [record] = await db.insert(locationHeartbeatsTable).values({
    id: `heartbeat-${randomUUID()}`,
    employeeId: body.employeeId ?? req.workforceAccess?.fieldOfficerId ?? req.workforceAccess?.userId ?? null,
    employeeName: body.employeeName,
    role: "Field Officer",
    city: body.city,
    site: body.site ?? req.workforceAccess?.siteName ?? null,
    dutyStatus: body.dutyStatus,
    latitude: body.latitude,
    longitude: body.longitude,
    accuracyMeters: body.accuracyMeters ?? null,
    capturedAt,
    source: body.source ?? "browser",
    deviceId: body.deviceId ?? null,
  }).returning();
  res.status(201).json(heartbeatResponse(record, policy));
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
  const heartbeatRows = await db.select().from(locationHeartbeatsTable)
    .orderBy(desc(locationHeartbeatsTable.capturedAt));
  const latestByOfficer = new Map<string, typeof heartbeatRows[number]>();
  for (const heartbeat of heartbeatRows) {
    const key = heartbeat.employeeId ?? heartbeat.employeeName;
    if (!latestByOfficer.has(key)) latestByOfficer.set(key, heartbeat);
  }
  const filtered = [...latestByOfficer.values()]
    .filter((heartbeat) =>
      (!assignedOfficerId || heartbeat.employeeId === assignedOfficerId) &&
      (!query.city || heartbeat.city === query.city) &&
      (!query.dutyStatus ||
        (query.dutyStatus === "on_duty" && !heartbeatResponse(heartbeat, policy).stale && heartbeat.dutyStatus === "On duty") ||
        (query.dutyStatus === "off_duty" && (heartbeatResponse(heartbeat, policy).stale || heartbeat.dutyStatus !== "On duty"))),
    ).map((heartbeat) => {
      const stale = heartbeatResponse(heartbeat, policy).stale;
      const x = Math.min(Math.max(((heartbeat.longitude - 77.35) / 0.55) * 100, 8), 90);
      const y = Math.min(Math.max(((13.15 - heartbeat.latitude) / 0.45) * 100, 10), 82);
      return {
        id: heartbeat.employeeId ?? heartbeat.id,
        name: heartbeat.employeeName,
        city: heartbeat.city,
        dutyStatus: stale ? "Offline" : heartbeat.dutyStatus,
        location: heartbeat.site ?? heartbeat.city,
        lastUpdate: lastSeenValue(heartbeat.capturedAt),
        coordinates: { x, y },
        latitude: heartbeat.latitude,
        longitude: heartbeat.longitude,
        accuracyMeters: heartbeat.accuracyMeters,
        stale,
        trackingWindow,
        heartbeatMinutes: policy.tracking.heartbeatMinutes,
      };
    });
  res.json(filtered);
});

router.get("/patrol/checkpoints", requireRole("Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (req, res) => {
  const records = await db.select().from(patrolCheckpointsTable)
    .where(eq(patrolCheckpointsTable.active, true))
    .orderBy(asc(patrolCheckpointsTable.sequence));
  const visible = records.filter((record) =>
    ["Management", "Control Room"].includes(req.workforceAccess?.role ?? "")
      || !record.site
      || record.site === req.workforceAccess?.siteName,
  );
  res.json(visible.map(checkpointResponse));
});

router.post("/patrol/checkpoints", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const body = req.body as {
    site?: string; name?: string; qrToken?: string; sequence?: number;
    latitude?: number; longitude?: number; radiusMeters?: number;
  };
  if (!body.site || !body.name || !body.qrToken || typeof body.sequence !== "number") {
    res.status(400).json({ error: "site, name, qrToken and sequence are required" });
    return;
  }
  const [record] = await db.insert(patrolCheckpointsTable).values({
    id: `checkpoint-${randomUUID()}`,
    site: body.site,
    name: body.name,
    qrToken: body.qrToken,
    sequence: body.sequence,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    radiusMeters: body.radiusMeters ?? 50,
  }).returning();
  res.status(201).json(checkpointResponse(record));
});

router.post("/patrol/scans", requireRole("Guard", "Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (req, res) => {
  const body = req.body as {
    checkpointToken?: string; roundId?: string; latitude?: number; longitude?: number;
    accuracyMeters?: number; note?: string; evidence?: Record<string, unknown>;
  };
  if (!body.checkpointToken || !body.roundId) {
    res.status(400).json({ error: "checkpointToken and roundId are required" });
    return;
  }
  const [checkpoint] = await db.select().from(patrolCheckpointsTable)
    .where(and(eq(patrolCheckpointsTable.qrToken, body.checkpointToken), eq(patrolCheckpointsTable.active, true)))
    .limit(1);
  if (!checkpoint) {
    res.status(422).json({ error: "Checkpoint QR is not configured or has been damaged. Ask a supervisor to replace it." });
    return;
  }
  const [duplicate] = await db.select().from(patrolScansTable)
    .where(and(eq(patrolScansTable.roundId, body.roundId), eq(patrolScansTable.checkpointId, checkpoint.id)))
    .limit(1);
  if (duplicate) {
    res.json(patrolScanResponse(duplicate));
    return;
  }
  const priorScans = await db.select().from(patrolScansTable)
    .where(eq(patrolScansTable.roundId, body.roundId));
  const expectedSequence = priorScans.length === 0
    ? 1
    : Math.max(...priorScans.map((scan) => {
      const known = scan.checkpointId === checkpoint.id ? checkpoint.sequence : 0;
      return known;
    })) + 1;
  const distance = typeof body.latitude === "number" && typeof body.longitude === "number"
    && checkpoint.latitude !== null && checkpoint.longitude !== null
    ? haversineMeters(body.latitude, body.longitude, checkpoint.latitude, checkpoint.longitude)
    : null;
  const status = checkpoint.sequence !== expectedSequence
    ? "Out of sequence"
    : distance !== null && distance > checkpoint.radiusMeters
      ? "Location exception"
      : "Verified";
  const [record] = await db.insert(patrolScansTable).values({
    id: `scan-${randomUUID()}`,
    checkpointId: checkpoint.id,
    roundId: body.roundId,
    scannedBy: operatorFor(req),
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    accuracyMeters: body.accuracyMeters ?? null,
    status,
    note: body.note ?? (distance !== null ? `${Math.round(distance)}m from checkpoint` : null),
    evidence: body.evidence ?? {},
  }).returning();
  res.status(201).json(patrolScanResponse(record));
});

router.get("/patrol/summary", requireRole("Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (_req, res) => {
  const scans = await db.select().from(patrolScansTable);
  const rounds = new Set(scans.map((scan) => scan.roundId)).size;
  const completed = scans.filter((scan) => scan.status === "Verified").length;
  const missed = scans.filter((scan) => scan.status !== "Verified").length;
  res.json({
    rounds,
    completed,
    missed,
    completionPercent: scans.length ? Math.round(completed / scans.length * 100) : 0,
  });
});

router.get("/incidents", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const records = await db.select().from(incidentRecordsTable)
    .orderBy(desc(incidentRecordsTable.reportedAt));
  const visible = records.filter((record) =>
    ["Management", "Control Room"].includes(req.workforceAccess?.role ?? "")
      || !record.site
      || record.site === req.workforceAccess?.siteName,
  );
  res.json(visible.map(incidentResponse));
});

router.post("/incidents", requireRole("Guard", "Supervisor", "Security Officer", "Field Officer", "Management", "Control Room"), async (req, res) => {
  const body = req.body as {
    category?: string; severity?: string; title?: string; narrative?: string; site?: string;
    affectedPeople?: string[]; affectedAssets?: string[]; latitude?: number; longitude?: number; dueAt?: string;
  };
  if (!body.category || !body.severity || !body.title || !body.narrative) {
    res.status(400).json({ error: "category, severity, title and narrative are required" });
    return;
  }
  const [record] = await db.insert(incidentRecordsTable).values({
    id: `incident-${randomUUID()}`,
    category: body.category,
    severity: body.severity,
    status: "Submitted",
    title: body.title,
    narrative: body.narrative,
    site: body.site ?? req.workforceAccess?.siteName ?? null,
    affectedPeople: body.affectedPeople ?? [],
    affectedAssets: body.affectedAssets ?? [],
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    dueAt: body.dueAt ? new Date(body.dueAt) : null,
    createdBy: operatorFor(req),
  }).returning();
  await db.insert(incidentEventsTable).values({
    id: `incident-event-${randomUUID()}`,
    incidentId: record.id,
    toStatus: "Submitted",
    actor: operatorFor(req),
    note: "Incident submitted",
  });
  res.status(201).json(incidentResponse(record));
});

router.patch("/incidents/:id/status", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const id = String(req.params.id);
  const body = req.body as { status?: string; note?: string };
  const validStatuses = ["Submitted", "Acknowledged", "Assigned", "In Progress", "Contained", "Closed", "Reopened"];
  if (!body.status || !validStatuses.includes(body.status)) {
    res.status(400).json({ error: "Invalid incident lifecycle status" });
    return;
  }
  const [existing] = await db.select().from(incidentRecordsTable)
    .where(eq(incidentRecordsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const timestamp = now();
  const [record] = await db.update(incidentRecordsTable).set({
    status: body.status,
    ...(body.status === "Acknowledged" ? { acknowledgedAt: timestamp } : {}),
    ...(body.status === "Assigned" ? { assignedAt: timestamp, assignedTo: operatorFor(req) } : {}),
    ...(body.status === "Contained" ? { containedAt: timestamp } : {}),
    ...(body.status === "Closed" ? { closedAt: timestamp } : {}),
    updatedAt: timestamp,
  }).where(eq(incidentRecordsTable.id, id)).returning();
  await db.insert(incidentEventsTable).values({
    id: `incident-event-${randomUUID()}`,
    incidentId: id,
    fromStatus: existing.status,
    toStatus: body.status,
    actor: operatorFor(req),
    note: body.note ?? null,
  });
  res.json(incidentResponse(record));
});

router.get("/roster/today", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const records = await db.select().from(rosterAssignmentsTable)
    .where(eq(rosterAssignmentsTable.rosterDate, todayKey()))
    .orderBy(asc(rosterAssignmentsTable.shift), asc(rosterAssignmentsTable.post));
  res.json(records.filter((record) =>
    ["Management", "Control Room"].includes(req.workforceAccess?.role ?? "")
      || record.site === req.workforceAccess?.siteName,
  ).map(rosterResponse));
});

router.post("/roster/today", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const body = req.body as {
    employeeId?: string; employeeName?: string; site?: string; post?: string; shift?: string;
    rosterDate?: string; replacementFor?: string;
  };
  if (!body.employeeId || !body.employeeName || !body.site || !body.post || !body.shift) {
    res.status(400).json({ error: "employeeId, employeeName, site, post and shift are required" });
    return;
  }
  const rosterDate = body.rosterDate ?? todayKey();
  const [conflict] = await db.select().from(rosterAssignmentsTable)
    .where(and(
      eq(rosterAssignmentsTable.rosterDate, rosterDate),
      eq(rosterAssignmentsTable.post, body.post),
      eq(rosterAssignmentsTable.shift, body.shift),
    )).limit(1);
  if (conflict && !body.replacementFor) {
    res.status(409).json({ error: "This post and shift already have an assignment.", conflict: rosterResponse(conflict) });
    return;
  }
  const [record] = await db.insert(rosterAssignmentsTable).values({
    id: `roster-${randomUUID()}`,
    employeeId: body.employeeId,
    employeeName: body.employeeName,
    site: body.site,
    post: body.post,
    shift: body.shift,
    rosterDate,
    status: body.replacementFor ? "Replacement pending" : "Published",
    replacementFor: body.replacementFor ?? null,
    createdBy: operatorFor(req),
  }).returning();
  res.status(201).json(rosterResponse(record));
});

router.get("/compliance", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const records = await db.select().from(complianceRecordsTable).orderBy(asc(complianceRecordsTable.expiresAt));
  res.json(records.filter((record) =>
    ["Management", "Control Room"].includes(req.workforceAccess?.role ?? "")
      || record.metadata && (record.metadata.site as string | undefined) === req.workforceAccess?.siteName
      || true,
  ).map(complianceResponse));
});

router.get("/reports/today", async (req, res) => {
  const [record] = await db.select().from(operationalReportsTable)
    .where(eq(operationalReportsTable.reportDate, todayKey())).limit(1);
  if (!record) {
    res.status(404).json({ error: "Daily Activity Report not submitted" });
    return;
  }
  res.json(reportResponse(record));
});

router.post("/reports/today", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const body = req.body as { site?: string; data?: Record<string, unknown> };
  if (!body.site || !body.data) {
    res.status(400).json({ error: "site and data are required" });
    return;
  }
  const [existing] = await db.select().from(operationalReportsTable)
    .where(eq(operationalReportsTable.reportDate, todayKey())).limit(1);
  const timestamp = now();
  const record = existing
    ? (await db.update(operationalReportsTable).set({
        site: body.site,
        data: body.data,
        status: "Submitted",
        submittedBy: operatorFor(req),
        updatedAt: timestamp,
      }).where(eq(operationalReportsTable.id, existing.id)).returning())[0]
    : (await db.insert(operationalReportsTable).values({
        id: `report-${todayKey()}`,
        reportDate: todayKey(),
        site: body.site,
        status: "Submitted",
        submittedBy: operatorFor(req),
        data: body.data,
      }).returning())[0];
  res.status(existing ? 200 : 201).json(reportResponse(record));
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

router.patch("/requests/:id/status", requireRole("Supervisor", "Security Officer", "Management", "Control Room"), async (req, res) => {
  const status = (req.body as { status?: string }).status;
  const allowed = ["Pending review", "Approved", "Rejected", "Needs information", "Paid"];
  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: "Invalid request status" });
    return;
  }
  const [existing] = await db.select().from(requestsTable)
    .where(eq(requestsTable.id, String(req.params.id))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  const [policyRecord] = await db.select().from(operatingPoliciesTable).limit(1);
  const policy = policyRecord ? policyInputFromRecord(policyRecord) : defaultPolicy;
  const timestamp = now();
  const [record] = await db.update(requestsTable).set({
    status,
    approvalData: {
      ...existing.approvalData,
      lastDecision: status,
      note: (req.body as { note?: string }).note ?? null,
      decidedBy: operatorFor(req),
      decidedAt: timestamp.toISOString(),
    },
  }).where(eq(requestsTable.id, existing.id)).returning();
  await db.insert(auditEventsTable).values({
    id: randomUUID(),
    entityType: "request",
    entityId: existing.id,
    action: `request_${status.toLowerCase().replaceAll(" ", "_")}`,
    actorId: operatorFor(req),
    summary: `${existing.type} marked ${status}`,
    metadata: { note: (req.body as { note?: string }).note ?? null },
  });
  res.json(requestResponse(record, policy));
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