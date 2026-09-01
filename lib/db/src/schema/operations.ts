import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  date,
  doublePrecision,
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
    employeeId: text("employee_id"),
    shift: text("shift").notNull(),
    site: text("site").notNull(),
    status: text("status").notNull(),
    punchInAt: timestamp("punch_in_at", { withTimezone: true }),
    punchOutAt: timestamp("punch_out_at", { withTimezone: true }),
    punchInLatitude: doublePrecision("punch_in_latitude"),
    punchInLongitude: doublePrecision("punch_in_longitude"),
    punchInAccuracyMeters: doublePrecision("punch_in_accuracy_meters"),
    punchInCapturedAt: timestamp("punch_in_captured_at", { withTimezone: true }),
    punchInReceivedAt: timestamp("punch_in_received_at", { withTimezone: true }),
    punchInSource: text("punch_in_source"),
    punchInVerification: text("punch_in_verification"),
    punchOutLatitude: doublePrecision("punch_out_latitude"),
    punchOutLongitude: doublePrecision("punch_out_longitude"),
    punchOutAccuracyMeters: doublePrecision("punch_out_accuracy_meters"),
    punchOutCapturedAt: timestamp("punch_out_captured_at", { withTimezone: true }),
    punchOutReceivedAt: timestamp("punch_out_received_at", { withTimezone: true }),
    punchOutSource: text("punch_out_source"),
    punchOutVerification: text("punch_out_verification"),
    correctionStatus: text("correction_status"),
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
  siteLatitude: doublePrecision("site_latitude").notNull().default(12.9716),
  siteLongitude: doublePrecision("site_longitude").notNull().default(77.7500),
  city: text("city").notNull().default("Bengaluru"),
  cityLatitude: doublePrecision("city_latitude").notNull().default(12.9716),
  cityLongitude: doublePrecision("city_longitude").notNull().default(77.5946),
  cityRadiusMeters: integer("city_radius_meters").notNull().default(50000),
  attendanceGraceMinutes: integer("attendance_grace_minutes").notNull().default(15),
  maxLocationAccuracyMeters: integer("max_location_accuracy_meters").notNull().default(100),
  offlineAttendanceEnabled: boolean("offline_attendance_enabled").notNull().default(true),
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
  approvalData: jsonb("approval_data").$type<Record<string, unknown>>().notNull().default({}),
});

export const attendanceEventsTable = pgTable(
  "attendance_events",
  {
    id: text("id").primaryKey(),
    attendanceId: text("attendance_id").notNull(),
    employeeId: text("employee_id"),
    employeeName: text("employee_name").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accuracyMeters: doublePrecision("accuracy_meters"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("online"),
    idempotencyKey: text("idempotency_key").notNull(),
    distanceFromSiteMeters: doublePrecision("distance_from_site_meters"),
    verification: text("verification"),
    reason: text("reason"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    actor: text("actor").notNull(),
    ...timestamps(),
  },
  (table) => ({
    idempotencyIndex: uniqueIndex("attendance_event_idempotency_idx").on(table.idempotencyKey),
  }),
);

export const locationHeartbeatsTable = pgTable("location_heartbeats", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id"),
  employeeName: text("employee_name").notNull(),
  role: text("role").notNull(),
  city: text("city").notNull(),
  site: text("site"),
  dutyStatus: text("duty_status").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracyMeters: doublePrecision("accuracy_meters"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull().default("browser"),
  deviceId: text("device_id"),
  isPrivate: boolean("is_private").notNull().default(false),
  ...timestamps(),
});

export const patrolCheckpointsTable = pgTable("patrol_checkpoints", {
  id: text("id").primaryKey(),
  site: text("site").notNull(),
  name: text("name").notNull(),
  qrToken: text("qr_token").notNull(),
  sequence: integer("sequence").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  radiusMeters: integer("radius_meters").notNull().default(50),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

export const patrolScansTable = pgTable("patrol_scans", {
  id: text("id").primaryKey(),
  checkpointId: text("checkpoint_id").notNull(),
  roundId: text("round_id").notNull(),
  scannedBy: text("scanned_by").notNull(),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracyMeters: doublePrecision("accuracy_meters"),
  status: text("status").notNull(),
  note: text("note"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
});

export const incidentRecordsTable = pgTable("incident_records", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  narrative: text("narrative").notNull(),
  site: text("site"),
  affectedPeople: jsonb("affected_people").$type<string[]>().notNull().default([]),
  affectedAssets: jsonb("affected_assets").$type<string[]>().notNull().default([]),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  containedAt: timestamp("contained_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  assignedTo: text("assigned_to"),
  createdBy: text("created_by").notNull(),
  ...timestamps(),
});

export const incidentEventsTable = pgTable("incident_events", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actor: text("actor").notNull(),
  note: text("note"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rosterAssignmentsTable = pgTable("roster_assignments", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  site: text("site").notNull(),
  post: text("post").notNull(),
  shift: text("shift").notNull(),
  rosterDate: date("roster_date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  replacementFor: text("replacement_for"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  conflictReason: text("conflict_reason"),
  createdBy: text("created_by").notNull(),
  ...timestamps(),
});

export const complianceRecordsTable = pgTable("compliance_records", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  employeeName: text("employee_name").notNull(),
  kind: text("kind").notNull(),
  reference: text("reference"),
  status: text("status").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
});

export const operationalReportsTable = pgTable("operational_reports", {
  id: text("id").primaryKey(),
  reportDate: date("report_date", { mode: "string" }).notNull(),
  site: text("site").notNull(),
  status: text("status").notNull(),
  submittedBy: text("submitted_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
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
export const insertAttendanceEventSchema = createInsertSchema(attendanceEventsTable);
export const insertLocationHeartbeatSchema = createInsertSchema(locationHeartbeatsTable);
export const insertPatrolCheckpointSchema = createInsertSchema(patrolCheckpointsTable);
export const insertPatrolScanSchema = createInsertSchema(patrolScansTable);
export const insertIncidentRecordSchema = createInsertSchema(incidentRecordsTable);
export const insertIncidentEventSchema = createInsertSchema(incidentEventsTable);
export const insertRosterAssignmentSchema = createInsertSchema(rosterAssignmentsTable);
export const insertComplianceRecordSchema = createInsertSchema(complianceRecordsTable);
export const insertOperationalReportSchema = createInsertSchema(operationalReportsTable);

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
export type AttendanceEvent = typeof attendanceEventsTable.$inferSelect;
export type LocationHeartbeat = typeof locationHeartbeatsTable.$inferSelect;
export type PatrolCheckpoint = typeof patrolCheckpointsTable.$inferSelect;
export type PatrolScan = typeof patrolScansTable.$inferSelect;
export type IncidentRecord = typeof incidentRecordsTable.$inferSelect;
export type IncidentEvent = typeof incidentEventsTable.$inferSelect;
export type RosterAssignment = typeof rosterAssignmentsTable.$inferSelect;
export type ComplianceRecord = typeof complianceRecordsTable.$inferSelect;
export type OperationalReport = typeof operationalReportsTable.$inferSelect;