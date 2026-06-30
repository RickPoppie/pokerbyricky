import { env } from "cloudflare:workers";

export const runtime = "edge";

const ACTIVE_WINDOW_MS = 45_000;
const ALLOWED_VOTES = new Set(["0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "?", "coffee"]);
const NUMERIC_VOTES = new Set(["0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40"]);
const DEFAULT_ROOM = "ricky";
const KICKED_MESSAGE = "Je bent verwijderd door de leider.";

type Action = "sync" | "join" | "vote" | "reveal" | "reset" | "makeLeader" | "kick";

type Payload = {
  action?: Action;
  clientId?: string;
  name?: string;
  roomId?: string;
  vote?: string;
  targetClientId?: string;
};

type RoomRow = {
  id: string;
  leader_client_id: string | null;
  revealed: number;
  round: number;
};

type ParticipantRow = {
  client_id: string;
  name: string;
  vote: string | null;
};

function getDatabase() {
  const db = env.DB as D1Database | undefined;
  if (!db) {
    throw new Error("D1 binding DB is niet beschikbaar.");
  }

  return db;
}

function normalizeRoomId(value: unknown) {
  if (typeof value !== "string") {
    return DEFAULT_ROOM;
  }

  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || DEFAULT_ROOM
  );
}

function normalizeClientId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

function normalizeVote(value: unknown) {
  return typeof value === "string" && ALLOWED_VOTES.has(value) ? value : null;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, leader_client_id TEXT, revealed INTEGER NOT NULL DEFAULT 0, round INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS participants (room_id TEXT NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL, vote TEXT, joined_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (room_id, client_id), FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS removed_participants (room_id TEXT NOT NULL, client_id TEXT NOT NULL, kicked_at INTEGER NOT NULL, PRIMARY KEY (room_id, client_id), FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE)"
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS participants_room_last_seen_idx ON participants (room_id, last_seen)"
    ),
  ]);
}

async function isKicked(db: D1Database, roomId: string, clientId: string) {
  const kick = await db
    .prepare("SELECT kicked_at FROM removed_participants WHERE room_id = ? AND client_id = ?")
    .bind(roomId, clientId)
    .first<{ kicked_at: number }>();

  return Boolean(kick);
}

async function touchParticipant(
  db: D1Database,
  roomId: string,
  clientId: string,
  name: string,
  now: number
) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO rooms (id, leader_client_id, revealed, round, updated_at) VALUES (?, NULL, 0, 1, ?)"
    )
    .bind(roomId, now)
    .run();

  await db
    .prepare(
      "INSERT INTO participants (room_id, client_id, name, vote, joined_at, last_seen) VALUES (?, ?, ?, NULL, ?, ?) ON CONFLICT(room_id, client_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen"
    )
    .bind(roomId, clientId, name, now, now)
    .run();
}

async function ensureLeader(db: D1Database, roomId: string, now: number) {
  const activeSince = now - ACTIVE_WINDOW_MS;
  const room = await db
    .prepare("SELECT id, leader_client_id, revealed, round FROM rooms WHERE id = ?")
    .bind(roomId)
    .first<RoomRow>();

  if (!room) {
    return null;
  }

  const leaderActive = room.leader_client_id
    ? await db
        .prepare(
          "SELECT client_id FROM participants WHERE room_id = ? AND client_id = ? AND last_seen >= ?"
        )
        .bind(roomId, room.leader_client_id, activeSince)
        .first<{ client_id: string }>()
    : null;

  if (leaderActive) {
    return room.leader_client_id;
  }

  const nextLeader = await db
    .prepare(
      "SELECT client_id FROM participants WHERE room_id = ? AND last_seen >= ? ORDER BY joined_at ASC, name ASC LIMIT 1"
    )
    .bind(roomId, activeSince)
    .first<{ client_id: string }>();

  const leaderClientId = nextLeader?.client_id ?? null;
  await db
    .prepare("UPDATE rooms SET leader_client_id = ?, updated_at = ? WHERE id = ?")
    .bind(leaderClientId, now, roomId)
    .run();

  return leaderClientId;
}

function calculateStats(players: ParticipantRow[]) {
  const values = players
    .map((player) => player.vote)
    .filter((vote): vote is string => Boolean(vote && NUMERIC_VOTES.has(vote)))
    .map(Number)
    .sort((a, b) => a - b);

  if (!values.length) {
    return { median: null, modes: [], numericVotes: 0 };
  }

  const midpoint = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 1
      ? String(values[midpoint])
      : values[midpoint - 1] === values[midpoint]
        ? String(values[midpoint])
        : `${values[midpoint - 1]} en ${values[midpoint]}`;

  const frequencies = new Map<string, number>();
  for (const value of values) {
    const key = String(value);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }

  const highestFrequency = Math.max(...frequencies.values());
  const modes = [...frequencies.entries()]
    .filter(([, count]) => count === highestFrequency)
    .map(([value]) => value);

  return { median, modes, numericVotes: values.length };
}

async function readRoomState(db: D1Database, roomId: string, now: number) {
  const activeSince = now - ACTIVE_WINDOW_MS;
  const room = await db
    .prepare("SELECT id, leader_client_id, revealed, round FROM rooms WHERE id = ?")
    .bind(roomId)
    .first<RoomRow>();

  const participants = await db
    .prepare(
      "SELECT client_id, name, vote FROM participants WHERE room_id = ? AND last_seen >= ? ORDER BY joined_at ASC, name ASC"
    )
    .bind(roomId, activeSince)
    .all<ParticipantRow>();

  const rows = participants.results ?? [];

  return {
    roomId,
    revealed: Boolean(room?.revealed),
    round: room?.round ?? 1,
    leaderClientId: room?.leader_client_id ?? null,
    players: rows.map((player) => ({
      clientId: player.client_id,
      name: player.name,
      vote: player.vote,
      isLeader: player.client_id === room?.leader_client_id,
    })),
    stats: Boolean(room?.revealed)
      ? calculateStats(rows)
      : { median: null, modes: [], numericVotes: 0 },
  };
}

async function requireLeader(db: D1Database, roomId: string, clientId: string, now: number) {
  const leaderClientId = await ensureLeader(db, roomId, now);
  return leaderClientId === clientId;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Payload;
    const action = payload.action ?? "sync";
    const roomId = normalizeRoomId(payload.roomId);
    const clientId = normalizeClientId(payload.clientId);
    const name = normalizeName(payload.name);
    const now = Date.now();

    if (!clientId || !name) {
      return Response.json({ error: "Naam en sessie zijn verplicht." }, { status: 400 });
    }

    if (!["sync", "join", "vote", "reveal", "reset", "makeLeader", "kick"].includes(action)) {
      return Response.json({ error: "Onbekende tafelactie." }, { status: 400 });
    }

    const db = getDatabase();
    await ensureSchema(db);
    if (action === "join") {
      await db
        .prepare("DELETE FROM removed_participants WHERE room_id = ? AND client_id = ?")
        .bind(roomId, clientId)
        .run();
    } else if (await isKicked(db, roomId, clientId)) {
      return Response.json({ kicked: true, error: KICKED_MESSAGE }, { status: 403 });
    }

    await touchParticipant(db, roomId, clientId, name, now);
    await ensureLeader(db, roomId, now);

    if (action === "vote") {
      const vote = normalizeVote(payload.vote);
      if (!vote) {
        return Response.json({ error: "Deze kaart bestaat niet." }, { status: 400 });
      }

      await db
        .prepare(
          "UPDATE participants SET vote = ?, last_seen = ? WHERE room_id = ? AND client_id = ?"
        )
        .bind(vote, now, roomId, clientId)
        .run();
    }

    if (action === "reveal") {
      const allowed = await requireLeader(db, roomId, clientId, now);
      if (!allowed) {
        const room = await readRoomState(db, roomId, now);
        return Response.json({ room, error: "Alleen de leider mag omdraaien." }, { status: 403 });
      }

      await db
        .prepare("UPDATE rooms SET revealed = 1, updated_at = ? WHERE id = ?")
        .bind(now, roomId)
        .run();
    }

    if (action === "reset") {
      const allowed = await requireLeader(db, roomId, clientId, now);
      if (!allowed) {
        const room = await readRoomState(db, roomId, now);
        return Response.json({ room, error: "Alleen de leider mag punten wissen." }, { status: 403 });
      }

      const currentRoom = await db
        .prepare("SELECT revealed FROM rooms WHERE id = ?")
        .bind(roomId)
        .first<{ revealed: number }>();

      if (!currentRoom?.revealed) {
        const room = await readRoomState(db, roomId, now);
        return Response.json(
          { room, error: "Draai eerst de kaarten om voordat je punten wist." },
          { status: 400 }
        );
      }

      await db.batch([
        db.prepare("UPDATE rooms SET revealed = 0, round = round + 1, updated_at = ? WHERE id = ?").bind(now, roomId),
        db.prepare("UPDATE participants SET vote = NULL WHERE room_id = ?").bind(roomId),
      ]);
    }

    if (action === "makeLeader") {
      const allowed = await requireLeader(db, roomId, clientId, now);
      if (!allowed) {
        const room = await readRoomState(db, roomId, now);
        return Response.json({ room, error: "Alleen de leider mag iemand leider maken." }, { status: 403 });
      }

      const targetClientId = normalizeClientId(payload.targetClientId);
      const activeSince = now - ACTIVE_WINDOW_MS;
      const target = targetClientId
        ? await db
            .prepare(
              "SELECT client_id FROM participants WHERE room_id = ? AND client_id = ? AND last_seen >= ?"
            )
            .bind(roomId, targetClientId, activeSince)
            .first<{ client_id: string }>()
        : null;

      if (!target) {
        const room = await readRoomState(db, roomId, now);
        return Response.json({ room, error: "Deze speler is niet actief aan tafel." }, { status: 400 });
      }

      await db
        .prepare("UPDATE rooms SET leader_client_id = ?, updated_at = ? WHERE id = ?")
        .bind(targetClientId, now, roomId)
        .run();
    }

    if (action === "kick") {
      const allowed = await requireLeader(db, roomId, clientId, now);
      if (!allowed) {
        const room = await readRoomState(db, roomId, now);
        return Response.json({ room, error: "Alleen de leider mag iemand verwijderen." }, { status: 403 });
      }

      const targetClientId = normalizeClientId(payload.targetClientId);
      if (!targetClientId || targetClientId === clientId) {
        const room = await readRoomState(db, roomId, now);
        return Response.json({ room, error: "Kies een andere speler om te verwijderen." }, { status: 400 });
      }

      const activeSince = now - ACTIVE_WINDOW_MS;
      const target = await db
        .prepare(
          "SELECT client_id FROM participants WHERE room_id = ? AND client_id = ? AND last_seen >= ?"
        )
        .bind(roomId, targetClientId, activeSince)
        .first<{ client_id: string }>();

      if (!target) {
        const room = await readRoomState(db, roomId, now);
        return Response.json({ room, error: "Deze speler is niet actief aan tafel." }, { status: 400 });
      }

      await db.batch([
        db
          .prepare(
            "INSERT INTO removed_participants (room_id, client_id, kicked_at) VALUES (?, ?, ?) ON CONFLICT(room_id, client_id) DO UPDATE SET kicked_at = excluded.kicked_at"
          )
          .bind(roomId, targetClientId, now),
        db
          .prepare("DELETE FROM participants WHERE room_id = ? AND client_id = ?")
          .bind(roomId, targetClientId),
        db.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").bind(now, roomId),
      ]);
    }

    await ensureLeader(db, roomId, now);
    const room = await readRoomState(db, roomId, now);
    return Response.json({ room });
  } catch (error) {
    const message = error instanceof Error ? error.message : "De tafel kon niet laden.";
    return Response.json({ error: message }, { status: 500 });
  }
}
