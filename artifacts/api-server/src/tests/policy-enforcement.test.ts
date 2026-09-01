import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import {
  attendanceRecordsTable,
  checklistItemsTable,
  db,
  operatingPoliciesTable,
  operatingPolicyRevisionsTable,
  requestsTable,
  sosAlertsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import operationsRouter from "../routes/operations";

type Json = Record<string, unknown> | unknown[];
type PolicyResponse = {
  id: string;
  version: number;
  siteName: string;
  siteAddress: string;
  timezone: string;
  shifts: Array<{
    id: string;
    name: string;
    startTime: string;
    endTime: string;
  }>;
  geofenceRadiusMeters: number;
  geofenceRequireInside: boolean;
  tracking: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    heartbeatMinutes: number;
    offlineAfterMinutes: number;
  };
  checklist: Array<{
    id: string;
    label: string;
    category: string;
    required: boolean;
  }>;
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
  updatedAt: string;
  updatedBy: string;
};

type PolicyUpdate = Omit<PolicyResponse, "id" | "updatedAt" | "updatedBy"> & {
  changeReason?: string;
};

type RequestOptions = {
  role?: "Guard" | "Management" | "Supervisor" | "Field Officer";
  body?: unknown;
};

type PolicyRevision = {
  id: string;
  changedSections: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  actor: string;
  createdAt: string;
};

const testApp = express();
testApp.use(express.json());
testApp.use((req, _res, next) => {
  const role = req.header("x-test-role") ?? "Management";
  const userId =
    req.header("x-test-user") ??
    `policy-tests-${role.toLowerCase().replaceAll(" ", "-")}`;
  const auth = Object.assign(
    () => ({
      isAuthenticated: true,
      tokenType: "session_token",
      userId,
      sessionClaims: {
        userId,
        metadata: {
          role,
          siteName: "Policy Test Site",
          fieldOfficerId: "fo-001",
        },
      },
    }),
    { [Symbol.for("@clerk/express.auth")]: true },
  );
  Object.assign(req, {
    auth,
  });
  next();
});
testApp.use("/api", operationsRouter);
testApp.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Request validation failed" });
      return;
    }
    next(error);
  },
);

let server: http.Server;
let baseUrl: string;
let baselinePolicy: PolicyResponse;
const createdRequestIds: string[] = [];
const createdSosIds: string[] = [];
const createdRevisionIds: string[] = [];

function policyBody(
  policy: PolicyResponse,
  overrides: Partial<PolicyUpdate> = {},
) {
  const {
    id: _id,
    updatedAt: _updatedAt,
    updatedBy: _updatedBy,
    ...body
  } = { ...policy, ...overrides };
  return body;
}

async function currentPolicyBody(overrides: Partial<PolicyUpdate> = {}) {
  const response = await api<PolicyResponse>("/policies/operating");
  assert.equal(response.status, 200);
  return policyBody({ ...response.body, ...overrides });
}

async function api<T extends Json>(
  path: string,
  options: RequestOptions = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: options.body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-test-role": options.role ?? "Management",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

async function textApi(
  path: string,
  options: Pick<RequestOptions, "role"> = {},
): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: {
      "x-test-role": options.role ?? "Management",
    },
  });
  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}

async function patchPolicy<T extends Json = PolicyResponse>(body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/policies/operating`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-test-role": "Management",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as T,
  };
}

before(async () => {
  server = testApp.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await api<PolicyResponse>("/policies/operating");
  assert.equal(response.status, 200);
  baselinePolicy = response.body;
});

after(async () => {
  try {
    if (baselinePolicy) {
      const current = await api<PolicyResponse>("/policies/operating");
      await patchPolicy(
        policyBody({ ...baselinePolicy, version: current.body.version }, {
          changeReason: "Restore policy test baseline",
        }),
      );
    }
    if (createdRequestIds.length > 0) {
      await db.delete(requestsTable).where(
        // The IDs are generated by this test process and are safe to clean up.
        (await import("drizzle-orm")).inArray(
          requestsTable.id,
          createdRequestIds,
        ),
      );
    }
    if (createdSosIds.length > 0) {
      await db
        .delete(sosAlertsTable)
        .where(
          (await import("drizzle-orm")).inArray(
            sosAlertsTable.id,
            createdSosIds,
          ),
        );
    }
    if (createdRevisionIds.length > 0) {
      await db
        .delete(operatingPolicyRevisionsTable)
        .where(
          (await import("drizzle-orm")).inArray(
            operatingPolicyRevisionsTable.id,
            createdRevisionIds,
          ),
        );
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe("operating policy enforcement", () => {
  test("reads, validates, persists, and exposes policy updates", async () => {
    const invalid = await fetch(`${baseUrl}/api/policies/operating`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-test-role": "Management",
      },
      body: JSON.stringify({
        ...policyBody(baselinePolicy),
        geofenceRadiusMeters: 0,
      }),
    });
    assert.equal(invalid.status, 400);

     const updated = await patchPolicy(
       policyBody(baselinePolicy, {
        siteName: "Policy Test Site",
        siteAddress: "Test Avenue, Bengaluru",
        geofenceRadiusMeters: 275,
        geofenceRequireInside: true,
        tracking: {
          ...baselinePolicy.tracking,
          enabled: false,
          heartbeatMinutes: 7,
          offlineAfterMinutes: 21,
        },
        sosAcknowledgementMinutes: 9,
        sosEscalationMessage: "Test control room escalation",
        requests: {
          ...baselinePolicy.requests,
          salaryAdvanceEnabled: false,
          salaryAdvanceMaxAmount: 12000,
          billSubmissionEnabled: false,
          billMaxAmount: 18000,
          billReceiptRequired: true,
        },
        changeReason: "Exercise all policy enforcement branches",
      }),
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.geofenceRadiusMeters, 275);
    assert.equal(updated.body.tracking.enabled, false);
    assert.equal(updated.body.requests.salaryAdvanceEnabled, false);
    assert.equal(updated.body.updatedBy, "policy-tests-management");

    const reread = await api<PolicyResponse>("/policies/operating");
    assert.equal(reread.status, 200);
    assert.equal(reread.body.siteAddress, "Test Avenue, Bengaluru");
    assert.equal(reread.body.sosAcknowledgementMinutes, 9);
    assert.deepEqual(reread.body.requests, updated.body.requests);

    const revisions = await api<
      Array<{
        changedSections: string[];
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        reason: string | null;
        actor: string;
      }>
    >("/policies/operating/revisions?limit=100");
    assert.equal(revisions.status, 200);
    const revision = revisions.body.find(
      (candidate) =>
        candidate.reason === "Exercise all policy enforcement branches" &&
        candidate.actor === "policy-tests-management",
    );
    assert.ok(revision);
    assert.ok(
      ["attendance", "tracking", "sos", "requests"].every((section) =>
        revision.changedSections.includes(section),
      ),
    );
    const beforeAttendance = revision.before.attendance as {
      geofenceRadiusMeters: number;
    };
    const afterAttendance = revision.after.attendance as {
      geofenceRadiusMeters: number;
    };
    assert.equal(beforeAttendance.geofenceRadiusMeters, baselinePolicy.geofenceRadiusMeters);
    assert.equal(afterAttendance.geofenceRadiusMeters, 275);
    const beforeTracking = revision.before.tracking as { enabled: boolean };
    const afterTracking = revision.after.tracking as { enabled: boolean };
    assert.equal(beforeTracking.enabled, baselinePolicy.tracking.enabled);
    assert.equal(afterTracking.enabled, false);
  });

  test("exports every policy comparison detail for management handover review", async () => {
    const current = await api<PolicyResponse>("/policies/operating");
    assert.equal(current.status, 200);

    try {
      const updated = await patchPolicy(
        policyBody(current.body, {
        siteName: "Export Review Site",
        siteAddress: "99 Incident Review Road, Bengaluru",
        timezone: "UTC",
        shifts: [
          {
            id: "export-shift",
            name: "Review",
            startTime: "09:15",
            endTime: "17:45",
          },
        ],
        geofenceRadiusMeters: 425,
        geofenceRequireInside: false,
        tracking: {
          enabled: false,
          startTime: "07:30",
          endTime: "19:45",
          heartbeatMinutes: 13,
          offlineAfterMinutes: 31,
        },
        checklist: [
          {
            id: "export-check",
            label: "Export handover detail",
            category: "Incident Review",
            required: false,
          },
        ],
        sosAcknowledgementMinutes: 12,
        sosEscalationMessage: "Escalate to the incident commander.",
        approvals: {
          verification: ["Management", "Control Room"],
          leave: ["Management"],
          salaryAdvance: ["Management", "Finance"],
          bills: ["Management", "Finance"],
        },
        requests: {
          salaryAdvanceEnabled: true,
          salaryAdvanceMaxAmount: 12345,
          billSubmissionEnabled: true,
          billMaxAmount: 23456,
          billReceiptRequired: true,
        },
        changeReason: "Prepare complete incident-review handover",
        }),
      );
      assert.equal(updated.status, 200);

      const revisions = await api<PolicyRevision[]>(
        "/policies/operating/revisions",
      );
      assert.equal(revisions.status, 200);
      const revision = revisions.body.find(
        (candidate) =>
          candidate.reason === "Prepare complete incident-review handover" &&
          candidate.actor === "policy-tests-management",
      );
      assert.ok(revision);
      createdRevisionIds.push(revision.id);

      const expectedSections = [
        "site",
        "attendance",
        "tracking",
        "checklist",
        "sos",
        "approvals",
        "requests",
      ];
      assert.deepEqual(
        [...revision.changedSections].sort(),
        [...expectedSections].sort(),
      );
      assert.equal(revision.actor, "policy-tests-management");
      assert.equal(
        revision.reason,
        "Prepare complete incident-review handover",
      );
      assert.ok(revision.createdAt);

      const exported = await textApi(
        `/policies/operating/revisions/${revision.id}/export`,
        { role: "Management" },
      );
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-type") ?? "", /^text\/plain/);
      assert.equal(
        exported.headers.get("content-disposition"),
        `attachment; filename="policy-revision-${revision.id}.txt"`,
      );

      assert.ok(exported.text.includes("BLACKBELT COMMANDOS"));
      assert.ok(exported.text.includes("Operating policy revision comparison"));
      assert.ok(exported.text.includes("Actor: policy-tests-management"));
      assert.ok(
        exported.text.includes(
          `Timestamp (UTC): ${new Date(revision.createdAt).toISOString()}`,
        ),
      );
      assert.ok(
        exported.text.includes(
          "Reason: Prepare complete incident-review handover",
        ),
      );
      for (const label of [
        "Site and shifts",
        "Attendance and geofence",
        "Live tracking",
        "Daily checklist",
        "SOS response",
        "Approval routing",
        "Employee requests",
      ]) {
        assert.ok(exported.text.includes(label), `missing section label: ${label}`);
      }

      assert.ok(exported.text.includes(`Before: ${current.body.siteName}`));
      assert.ok(exported.text.includes("After: Export Review Site"));
      assert.ok(
        exported.text.includes("After: 99 Incident Review Road, Bengaluru"),
      );
      assert.ok(exported.text.includes("After: UTC"));
      assert.ok(exported.text.includes("After: Review · 09:15–17:45"));

      assert.ok(exported.text.includes("Geofence radius"));
      assert.ok(exported.text.includes("After: 425 metres"));
      assert.ok(
        exported.text.includes("Require presence inside geofence"),
      );
      assert.ok(exported.text.includes("After: No"));

      assert.ok(exported.text.includes("Location tracking"));
      assert.ok(exported.text.includes("After: Disabled"));
      assert.ok(exported.text.includes("Operating window"));
      assert.ok(exported.text.includes("After: 07:30–19:45"));
      assert.ok(exported.text.includes("After: 13 minutes"));
      assert.ok(exported.text.includes("After: 31 minutes"));

      assert.ok(exported.text.includes("Checklist items"));
      assert.ok(
        exported.text.includes(
          "After: Export handover detail · Incident Review · Optional",
        ),
      );

      assert.ok(exported.text.includes("Acknowledgement window"));
      assert.ok(exported.text.includes("After: 12 minutes"));
      assert.ok(
        exported.text.includes(
          "After: Escalate to the incident commander.",
        ),
      );

      assert.ok(exported.text.includes("Employee verification"));
      assert.ok(exported.text.includes("After: Management → Control Room"));
      assert.ok(exported.text.includes("Leave requests"));
      assert.ok(exported.text.includes("After: Management"));
      assert.ok(exported.text.includes("Salary advances"));
      assert.ok(exported.text.includes("After: Management → Finance"));
      assert.ok(exported.text.includes("Bill submissions"));
      assert.ok(exported.text.includes("After: Management → Finance"));

      assert.ok(exported.text.includes("After: Yes · up to ₹12,345"));
      assert.ok(
        exported.text.includes(
          "After: Yes · up to ₹23,456 · Receipt required",
        ),
      );

      const [policy] = await db
        .select({ id: operatingPoliciesTable.id })
        .from(operatingPoliciesTable)
        .limit(1);
      assert.ok(policy);
      const legacyRevisionId = randomUUID();
      const legacyCreatedAt = new Date("2020-01-02T03:04:00.000Z");
      await db.insert(operatingPolicyRevisionsTable).values({
        id: legacyRevisionId,
        policyId: policy.id,
        changedSections: ["site"],
        beforeValues: {},
        afterValues: {},
        reason: "Imported from the legacy policy log",
        actor: "legacy-management",
        createdAt: legacyCreatedAt,
      });
      createdRevisionIds.push(legacyRevisionId);

      const legacyExport = await textApi(
        `/policies/operating/revisions/${legacyRevisionId}/export`,
        { role: "Management" },
      );
      assert.equal(legacyExport.status, 200);
      assert.ok(legacyExport.text.includes("Actor: legacy-management"));
      assert.ok(
        legacyExport.text.includes(
          "Timestamp (UTC): 2020-01-02T03:04:00.000Z",
        ),
      );
      assert.ok(
        legacyExport.text.includes(
          "Reason: Imported from the legacy policy log",
        ),
      );
      assert.ok(legacyExport.text.includes("Changed sections: Site and shifts"));
      assert.ok(
        legacyExport.text.includes(
          "Before-and-after values were not recorded for this older revision.",
        ),
      );
    } finally {
      const latest = await api<PolicyResponse>("/policies/operating");
      assert.equal(latest.status, 200);
      const restored = await patchPolicy(
        policyBody(
          { ...current.body, version: latest.body.version },
          { changeReason: "Restore policy after export test" },
        ),
      );
      assert.equal(restored.status, 200);
    }
  });

  test("retrieves and exports policy handovers beyond the latest 20 revisions", async () => {
    const [policy] = await db
      .select({ id: operatingPoliciesTable.id })
      .from(operatingPoliciesTable)
      .limit(1);
    assert.ok(policy);

    const revisionIds = Array.from({ length: 25 }, () => randomUUID());
    await db.insert(operatingPolicyRevisionsTable).values(
      revisionIds.map((id, index) => ({
        id,
        policyId: policy.id,
        changedSections: ["site"],
        beforeValues: { site: { siteName: `Audit site ${index}` } },
        afterValues: { site: { siteName: `Audit site ${index + 1}` } },
        reason: `Pagination audit revision ${index}`,
        actor: "pagination-audit-manager",
        createdAt: new Date(`2040-01-01T00:00:${String(index).padStart(2, "0")}.000Z`),
      })),
    );
    createdRevisionIds.push(...revisionIds);

    const olderPage = await api<PolicyRevision[]>(
      "/policies/operating/revisions?offset=20&limit=5",
    );
    assert.equal(olderPage.status, 200);
    assert.equal(olderPage.body.length, 5);
    assert.equal(olderPage.body[0]?.id, revisionIds[4]);
    assert.equal(olderPage.body[4]?.id, revisionIds[0]);

    const oldestRevision = olderPage.body[4];
    assert.ok(oldestRevision);
    const exported = await textApi(
      `/policies/operating/revisions/${oldestRevision.id}/export`,
      { role: "Management" },
    );
    assert.equal(exported.status, 200);
    assert.ok(exported.text.includes("Reason: Pagination audit revision 0"));
    assert.ok(exported.text.includes("Actor: pagination-audit-manager"));
    assert.ok(exported.text.includes("Before: Audit site 0"));
    assert.ok(exported.text.includes("After: Audit site 1"));
  });

  test("rolls back policy and dependent records when revision creation fails", async () => {
    const [policy] = await db.select().from(operatingPoliciesTable).limit(1);
    assert.ok(policy);
    const before = {
      policy,
      checklist: await db.select().from(checklistItemsTable),
      attendance: await db.select().from(attendanceRecordsTable),
      revisions: await db.select().from(operatingPolicyRevisionsTable),
    };

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.update(operatingPoliciesTable).set({
          siteAddress: "This update must be rolled back",
        }).where(eq(operatingPoliciesTable.id, policy.id));
        await tx.delete(checklistItemsTable);
        await tx.insert(checklistItemsTable).values({
          id: "rollback-checklist-item",
          label: "This checklist sync must be rolled back",
          category: "Test",
          required: true,
          completed: false,
        });
        const [attendance] = await tx.select().from(attendanceRecordsTable).limit(1);
        if (attendance) {
          await tx.update(attendanceRecordsTable).set({
            site: "This attendance refresh must be rolled back",
          }).where(eq(attendanceRecordsTable.id, attendance.id));
        }
        await tx.insert(operatingPolicyRevisionsTable).values({
          id: randomUUID(),
          policyId: policy.id,
          changedSections: ["site"],
          beforeValues: {},
          afterValues: {},
          reason: "Intentional rollback-boundary failure",
          // The database constraint simulates a revision write failure.
          actor: null as unknown as string,
        });
      }),
    );

    const after = {
      policy: (await db.select().from(operatingPoliciesTable).limit(1))[0],
      checklist: await db.select().from(checklistItemsTable),
      attendance: await db.select().from(attendanceRecordsTable),
      revisions: await db.select().from(operatingPolicyRevisionsTable),
    };
    assert.deepEqual(after, before);
  });

  test("rejects attendance outside the saved geofence and returns policy fields", async () => {
    const response = await api<{ error: string }>("/attendance/punch", {
      body: {
        action: "in",
        location: "Outside test site",
        geofenceVerified: false,
      },
    });
    assert.equal(response.status, 422);
    assert.match(response.body.error, /275m site geofence/);

    const attendance = await api<{
      siteAddress: string;
      geofenceRadiusMeters: number;
      shiftWindow: string;
    }>("/attendance/today");
    assert.equal(attendance.status, 200);
    assert.equal(attendance.body.siteAddress, "Test Avenue, Bengaluru");
    assert.equal(attendance.body.geofenceRadiusMeters, 275);
    assert.equal(
      attendance.body.shiftWindow,
      baselinePolicy.shifts[0] &&
        `${baselinePolicy.shifts[0].startTime}–${baselinePolicy.shifts[0].endTime}`,
    );
  });

  test("enforces request toggles, amount limits, and receipt requirements", async () => {
    const salaryDisabled = await api<{ error: string }>(
      "/requests/salary-advance",
      {
        body: { amount: 1000, reason: "Emergency travel" },
      },
    );
    assert.equal(salaryDisabled.status, 422);
    assert.match(salaryDisabled.body.error, /currently disabled/);

    const billDisabled = await api<{ error: string }>("/requests/bills", {
      body: {
        amount: 1000,
        category: "Travel",
        billDate: "2026-09-01",
        vendor: "Test vendor",
      },
    });
    assert.equal(billDisabled.status, 422);
    assert.match(billDisabled.body.error, /currently disabled/);

     await patchPolicy(
       await currentPolicyBody({
        requests: {
          ...baselinePolicy.requests,
          salaryAdvanceEnabled: true,
          salaryAdvanceMaxAmount: 1500,
          billSubmissionEnabled: true,
          billMaxAmount: 2000,
          billReceiptRequired: true,
        },
        changeReason: "Test request thresholds",
      }),
    );

    const salaryOverLimit = await api<{ error: string }>(
      "/requests/salary-advance",
      {
        body: { amount: 1501, reason: "Emergency travel" },
      },
    );
    assert.equal(salaryOverLimit.status, 422);
    assert.match(salaryOverLimit.body.error, /₹1,500/);

    const billOverLimit = await api<{ error: string }>("/requests/bills", {
      body: {
        amount: 2001,
        category: "Travel",
        billDate: "2026-09-01",
        vendor: "Test vendor",
        receiptReference: "R-1",
      },
    });
    assert.equal(billOverLimit.status, 422);
    assert.match(billOverLimit.body.error, /₹2,000/);

    const missingReceipt = await api<{ error: string }>("/requests/bills", {
      body: {
        amount: 500,
        category: "Travel",
        billDate: "2026-09-01",
        vendor: "Test vendor",
      },
    });
    assert.equal(missingReceipt.status, 422);
    assert.match(missingReceipt.body.error, /receipt reference is required/);

    const successful = await api<{
      id: string;
      approvalPath: string;
      summary: string;
    }>("/requests/bills", {
      body: {
        amount: 500,
        category: "Travel",
        billDate: "2026-09-01",
        vendor: "Test vendor",
        receiptReference: "R-2",
      },
    });
    assert.equal(successful.status, 201);
    assert.equal(
      successful.body.approvalPath,
      baselinePolicy.approvals.bills.join(" → "),
    );
    assert.match(successful.body.summary, /Test vendor/);
    createdRequestIds.push(successful.body.id);
  });

  test("includes the saved SOS acknowledgement window and due time", async () => {
     const sosPolicy = await patchPolicy(
       await currentPolicyBody({
        sosAcknowledgementMinutes: 9,
        sosEscalationMessage: "Test control room escalation",
        changeReason: "Test SOS acknowledgement timing",
      }),
    );
    assert.equal(sosPolicy.status, 200);

    const response = await api<{
      id: string;
      status: string;
      acknowledgementWindowMinutes: number;
      createdAt: string;
      acknowledgementDueAt: string;
    }>("/emergency/sos", {
      body: {
        employeeName: "Policy Test Guard",
        location: "Test gate",
        drill: true,
      },
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.acknowledgementWindowMinutes, 9);
    assert.match(response.body.status, /Ack in 9 min/);
    assert.equal(
      new Date(response.body.acknowledgementDueAt).getTime() -
        new Date(response.body.createdAt).getTime(),
      9 * 60_000,
    );
    createdSosIds.push(response.body.id);
  });

  test("returns policy-derived tracking and approval fields", async () => {
     const trackingPolicy = await patchPolicy(
       await currentPolicyBody({
        tracking: {
          ...baselinePolicy.tracking,
          enabled: true,
          startTime: "00:00",
          endTime: "23:59",
          heartbeatMinutes: 11,
          offlineAfterMinutes: 33,
        },
        approvals: {
          ...baselinePolicy.approvals,
          verification: ["Supervisor", "Control Room"],
        },
        changeReason: "Test derived response fields",
      }),
    );
    assert.equal(trackingPolicy.status, 200);

    const tracking = await api<
      Array<{
        trackingWindow: string;
        heartbeatMinutes: number;
      }>
    >("/tracking/field-officers");
    assert.equal(tracking.status, 200);
    assert.ok(tracking.body.length > 0);
    assert.equal(tracking.body[0]?.trackingWindow, "00:00–23:59");
    assert.equal(tracking.body[0]?.heartbeatMinutes, 11);

    const submissions = await api<Array<{ approvalPath: string }>>(
      "/employee-submissions",
    );
    assert.equal(submissions.status, 200);
    assert.ok(submissions.body.length > 0);
    assert.equal(
      submissions.body[0]?.approvalPath,
      "Supervisor → Control Room",
    );
  });

  test("rejects stale policy saves without changing the winning policy or revision", async () => {
    const loaded = await api<PolicyResponse>("/policies/operating");
    assert.equal(loaded.status, 200);

    const winning = await patchPolicy(
      policyBody(loaded.body, {
        siteAddress: "Concurrency winner avenue, Bengaluru",
        changeReason: "Concurrency winner",
      }),
    );
    assert.equal(winning.status, 200);
    assert.equal(winning.body.siteAddress, "Concurrency winner avenue, Bengaluru");
    assert.equal(winning.body.version, loaded.body.version + 1);

    const stale = await patchPolicy<{
      error: string;
      currentPolicy: PolicyResponse;
    }>(
      policyBody(loaded.body, {
        siteAddress: "Stale overwrite avenue, Bengaluru",
        changeReason: "Stale overwrite must not be recorded",
      }),
    );
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /changed after you loaded it/i);
    assert.equal(stale.body.currentPolicy.siteAddress, winning.body.siteAddress);
    assert.equal(stale.body.currentPolicy.version, winning.body.version);

    const reread = await api<PolicyResponse>("/policies/operating");
    assert.equal(reread.status, 200);
    assert.equal(reread.body.siteAddress, "Concurrency winner avenue, Bengaluru");
    assert.equal(reread.body.version, winning.body.version);

    const revisions = await api<
      Array<{ reason: string | null; actor: string }>
    >("/policies/operating/revisions?limit=100");
    assert.equal(revisions.status, 200);
    assert.ok(revisions.body.some((revision) => revision.reason === "Concurrency winner"));
    assert.ok(
      !revisions.body.some(
        (revision) => revision.reason === "Stale overwrite must not be recorded",
      ),
    );
  });

  test("prevents non-management roles from updating policy", async () => {
    const response = await fetch(`${baseUrl}/api/policies/operating`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-role": "Guard" },
      body: JSON.stringify(policyBody(baselinePolicy)),
    });
    assert.equal(response.status, 403);
  });
});
