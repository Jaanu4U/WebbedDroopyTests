import { createInsertSchema } from "drizzle-zod";
import {
  jsonb,
  pgTable,
  text,
  timestamp,
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

export const workforceItemsTable = pgTable("workforce_items", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").notNull().default("normal"),
  site: text("site"),
  city: text("city"),
  ownerId: text("owner_id"),
  assigneeId: text("assignee_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps(),
});

export const auditEventsTable = pgTable("audit_events", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id").notNull(),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertWorkforceItemSchema = createInsertSchema(workforceItemsTable);
export const insertAuditEventSchema = createInsertSchema(auditEventsTable);

export type WorkforceItem = typeof workforceItemsTable.$inferSelect;
export type InsertWorkforceItem = z.infer<typeof insertWorkforceItemSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;