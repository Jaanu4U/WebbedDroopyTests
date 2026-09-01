import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const attendanceRecordsTable = pgTable(
  "attendance_records",
  {
    id: text("id").primaryKey(),
    employeeName: text("employee_name").notNull(),
    shift: text("shift").notNull(),
    site: text("site").notNull(),
    status: text("status").notNull(),
    punchInAt: timestamp("punch_in_at", { withTimezone: true }),
    punchOutAt: timestamp("punch_out_at", { withTimezone: true }),
    geofence: text("geofence").notNull(),
    attendanceDate: date("attendance_date", { mode: "string" }).notNull(),
    ...timestamps(),
  },
  (table) => ({
    employeeDateIndex: uniqueIndex("attendance_employee_date_idx").on(
      table.employeeName,
      table.attendanceDate,
    ),
  }),
);

export const guardsTable = pgTable("guards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  post: text("post").notNull(),
  shift: text("shift").notNull(),
  status: text("status").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  checkedInBy: text("checked_in_by"),
  ...timestamps(),
});

export const checklistItemsTable = pgTable("checklist_items", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  required: boolean("required").notNull().default(true),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: text("completed_by"),
  ...timestamps(),
});

export const operatingPoliciesTable = pgTable("operating_policies", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().default(1),
  siteName: text("site_name").notNull(),
  siteAddress: text("site_address").notNull(),
  timezone: text("timezone").notNull(),
  shifts: jsonb("shifts").notNull(),
  geofenceRadiusMeters: integer("geofence_radius_meters").notNull(),
  geofenceRequireInside: boolean("geofence_require_inside").notNull().default(true),
  trackingEnabled: boolean("tracking_enabled").notNull().default(true),
  trackingStartTime: text("tracking_start_time").notNull(),
  trackingEndTime: text("tracking_end_time").notNull(),
  trackingHeartbeatMinutes: integer("tracking_heartbeat_minutes").notNull(),
  trackingOfflineAfterMinutes: integer("tracking_offline_after_minutes").notNull(),
  checklistItems: jsonb("checklist_items").notNull(),
  sosAcknowledgementMinutes: integer("sos_acknowledgement_minutes").notNull(),
  sosEscalationMessage: text("sos_escalation_message").notNull(),
  verificationApprovalRoles: jsonb("verification_approval_roles").notNull(),
  leaveApprovalRoles: jsonb("leave_approval_roles").notNull(),
  salaryAdvanceApprovalRoles: jsonb("salary_advance_approval_roles").notNull(),
  billApprovalRoles: jsonb("bill_approval_roles").notNull(),
  salaryAdvanceEnabled: boolean("salary_advance_enabled").notNull().default(true),
  salaryAdvanceMaxAmount: integer("salary_advance_max_amount").notNull(),
  billSubmissionEnabled: boolean("bill_submission_enabled").notNull().default(true),
  billMaxAmount: integer("bill_max_amount").notNull(),
  billReceiptRequired: boolean("bill_receipt_required").notNull().default(true),
  updatedBy: text("updated_by").notNull().default("System"),
  ...timestamps(),
});

export const operatingPolicyRevisionsTable = pgTable("operating_policy_revisions", {
  id: text("id").primaryKey(),
  policyId: text("policy_id").notNull(),
  changedSections: jsonb("changed_sections").$type<string[]>().notNull(),
  beforeValues: jsonb("before_values")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  afterValues: jsonb("after_values")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  reason: text("reason"),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const employeeSubmissionsTable = pgTable("employee_submissions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  city: text("city").notNull(),
  submittedBy: text("submitted_by").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: text("status").notNull(),
  documents: integer("documents").notNull().default(0),
  note: text("note"),
  decisionAt: timestamp("decision_at", { withTimezone: true }),
  decisionBy: text("decision_by"),
  ...timestamps(),
});

export const sosAlertsTable = pgTable("sos_alerts", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  employeeName: text("employee_name").notNull(),
  location: text("location").notNull(),
  drill: boolean("drill").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  triggeredBy: text("triggered_by").notNull(),
});

export const requestsTable = pgTable("requests", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  summary: text("summary").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: text("status").notNull(),
  submittedBy: text("submitted_by").notNull(),
});

export const insertAttendanceRecordSchema = createInsertSchema(
  attendanceRecordsTable,
);
export const insertGuardSchema = createInsertSchema(guardsTable);
export const insertChecklistItemSchema = createInsertSchema(checklistItemsTable);
export const insertOperatingPolicySchema = createInsertSchema(operatingPoliciesTable);
export const insertOperatingPolicyRevisionSchema = createInsertSchema(
  operatingPolicyRevisionsTable,
);
export const insertEmployeeSubmissionSchema = createInsertSchema(
  employeeSubmissionsTable,
);
export const insertSosAlertSchema = createInsertSchema(sosAlertsTable);
export const insertRequestSchema = createInsertSchema(requestsTable);

export type InsertAttendanceRecord = z.infer<
  typeof insertAttendanceRecordSchema
>;
export type InsertOperatingPolicyRevision = z.infer<
  typeof insertOperatingPolicyRevisionSchema
>;
export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
export type Guard = typeof guardsTable.$inferSelect;
export type ChecklistItem = typeof checklistItemsTable.$inferSelect;
export type OperatingPolicy = typeof operatingPoliciesTable.$inferSelect;
export type OperatingPolicyRevision =
  typeof operatingPolicyRevisionsTable.$inferSelect;
export type EmployeeSubmission = typeof employeeSubmissionsTable.$inferSelect;
export type SosAlert = typeof sosAlertsTable.$inferSelect;
export type Request = typeof requestsTable.$inferSelect;