import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  leaderClientId: text("leader_client_id"),
  revealed: integer("revealed", { mode: "boolean" }).notNull().default(false),
  round: integer("round").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

export const participants = sqliteTable(
  "participants",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    vote: text("vote"),
    joinedAt: integer("joined_at").notNull(),
    lastSeen: integer("last_seen").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roomId, table.clientId],
    }),
  ]
);

export const removedParticipants = sqliteTable(
  "removed_participants",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    kickedAt: integer("kicked_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.roomId, table.clientId],
    }),
  ]
);
