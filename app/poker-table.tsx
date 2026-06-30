"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const CARD_VALUES = ["0", "0.5", "1", "2", "3", "5", "8", "13", "20", "40", "?", "coffee"] as const;
const COFFEE = "\u2615";
const CROWN = "\u2655";
const DEFAULT_ROOM = "ricky";
const PLAYING_CARDS = "\uD83C\uDCCF";

type Player = {
  clientId: string;
  name: string;
  vote: string | null;
  isLeader: boolean;
};

type RoomStats = {
  median: string | null;
  modes: string[];
  numericVotes: number;
};

type RoomState = {
  roomId: string;
  revealed: boolean;
  round: number;
  leaderClientId: string | null;
  players: Player[];
  stats: RoomStats;
};

type RoomResponse = {
  room?: RoomState;
  error?: string;
  kicked?: boolean;
};

function getStoredClientId() {
  const existing = window.localStorage.getItem("ricky-client-id");
  if (existing) {
    return existing;
  }

  const created =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem("ricky-client-id", created);
  return created;
}

function normalizeRoom(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || DEFAULT_ROOM
  );
}

function displayVote(vote: string | null) {
  if (!vote) {
    return "Geen";
  }

  return vote === "coffee" ? COFFEE : vote;
}

function displayModes(modes: string[]) {
  if (!modes.length) {
    return "Geen";
  }

  return modes.map(displayVote).join(", ");
}

function formatAmsterdamTime() {
  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).format(new Date());
}

export default function PokerTable() {
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [roomInput, setRoomInput] = useState(DEFAULT_ROOM);
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [shareState, setShareState] = useState("Kopieer link");
  const [amsterdamTime, setAmsterdamTime] = useState("");
  const [autoJoinFromLink, setAutoJoinFromLink] = useState(false);
  const [kickedMessage, setKickedMessage] = useState("");
  const [kickedRoomId, setKickedRoomId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const roomFromUrl = params.get("room") ? normalizeRoom(params.get("room") ?? "") : "";
      const storedName = window.localStorage.getItem("ricky-player-name") ?? "";
      const storedRoom =
        roomFromUrl || window.localStorage.getItem("ricky-room") || DEFAULT_ROOM;

      setClientId(getStoredClientId());
      setName(storedName);
      setRoomInput(normalizeRoom(storedRoom));
      setAutoJoinFromLink(Boolean(roomFromUrl));
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const updateTime = () => setAmsterdamTime(formatAmsterdamTime());

    updateTime();
    const interval = window.setInterval(updateTime, 10_000);

    return () => window.clearInterval(interval);
  }, []);

  const activeRoomId = useMemo(() => normalizeRoom(roomInput), [roomInput]);

  const sendRoomAction = useCallback(
    async (
      action: string,
      extra: Record<string, unknown> = {},
      overrides: { name?: string; roomId?: string } = {}
    ) => {
      const actionName = (overrides.name ?? name).trim();
      const actionRoomId = overrides.roomId ?? activeRoomId;

      if (!clientId || !actionName) {
        return false;
      }

      setError("");
      const response = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          clientId,
          name: actionName,
          roomId: actionRoomId,
          ...extra,
        }),
      });

      const data = (await response.json()) as RoomResponse;
      if (data.kicked) {
        setKickedRoomId(actionRoomId);
        setKickedMessage(data.error ?? "Je bent verwijderd door de leider.");
        setJoined(false);
        setRoom(null);
        setSelectedVote(null);
        setSelectedPlayerId(null);
        return false;
      }

      if (data.room) {
        setRoom(data.room);
        const currentPlayer = data.room.players.find(
          (player) => player.clientId === clientId
        );
        setSelectedVote(currentPlayer?.vote ?? null);
      }

      if (!response.ok || data.error) {
        setError(data.error ?? "De tafel reageerde niet zoals verwacht.");
      }

      return response.ok && !data.error;
    },
    [activeRoomId, clientId, name]
  );

  const enterTable = useCallback(
    async (cleanName: string, cleanRoom: string) => {
      window.localStorage.setItem("ricky-player-name", cleanName);
      window.localStorage.setItem("ricky-room", cleanRoom);
      window.history.replaceState(null, "", `?room=${cleanRoom}`);
      setAutoJoinFromLink(false);
      setKickedMessage("");
      setKickedRoomId("");
      setName(cleanName);
      setRoomInput(cleanRoom);
      setBusyAction("join");
      try {
        const joinedRoom = await sendRoomAction("join", {}, { name: cleanName, roomId: cleanRoom });
        setJoined(joinedRoom);
      } finally {
        setBusyAction(null);
      }
    },
    [sendRoomAction]
  );

  useEffect(() => {
    if (!autoJoinFromLink || joined || !clientId || kickedRoomId === activeRoomId) {
      return;
    }

    const cleanName = name.trim().slice(0, 40);
    if (!cleanName) {
      return;
    }

    const timer = window.setTimeout(() => {
      void enterTable(cleanName, activeRoomId);
    }, 800);

    return () => window.clearTimeout(timer);
  }, [activeRoomId, autoJoinFromLink, clientId, enterTable, joined, kickedRoomId, name]);

  useEffect(() => {
    if (joined && name.trim()) {
      window.localStorage.setItem("ricky-player-name", name.trim().slice(0, 40));
    }
  }, [joined, name]);

  useEffect(() => {
    if (!joined) {
      return;
    }

    const firstSync = window.setTimeout(() => {
      void sendRoomAction("sync");
    }, 0);
    const interval = window.setInterval(() => {
      void sendRoomAction("sync");
    }, 1400);

    return () => {
      window.clearTimeout(firstSync);
      window.clearInterval(interval);
    };
  }, [joined, sendRoomAction]);

  const currentPlayer = room?.players.find((player) => player.clientId === clientId);
  const selectedPlayer = room?.players.find(
    (player) => player.clientId === selectedPlayerId
  );
  const isLeader = Boolean(currentPlayer?.isLeader);
  const canVote = joined && !room?.revealed;
  const roomUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}?room=${activeRoomId}`;

  function joinTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim().slice(0, 40);
    const cleanRoom = normalizeRoom(roomInput);

    if (!cleanName) {
      setError("Vul eerst je naam in.");
      return;
    }

    void enterTable(cleanName, cleanRoom);
  }

  async function chooseVote(vote: string) {
    if (!canVote) {
      return;
    }

    setSelectedVote(vote);
    setBusyAction(`vote-${vote}`);
    await sendRoomAction("vote", { vote });
    setBusyAction(null);
  }

  async function leaderAction(action: "reveal" | "reset") {
    setBusyAction(action);
    await sendRoomAction(action);
    setBusyAction(null);
  }

  async function makeSelectedPlayerLeader() {
    if (!selectedPlayer || selectedPlayer.isLeader) {
      return;
    }

    setBusyAction("makeLeader");
    await sendRoomAction("makeLeader", { targetClientId: selectedPlayer.clientId });
    setBusyAction(null);
  }

  async function kickSelectedPlayer() {
    if (!selectedPlayer || selectedPlayer.clientId === clientId) {
      return;
    }

    setBusyAction("kick");
    await sendRoomAction("kick", { targetClientId: selectedPlayer.clientId });
    setSelectedPlayerId(null);
    setBusyAction(null);
  }

  async function copyRoomLink() {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setShareState("Gekopieerd");
    } catch {
      setShareState(roomUrl);
    }

    window.setTimeout(() => setShareState("Kopieer link"), 2200);
  }

  return (
    <main className="min-h-screen bg-[#113c33] text-[#fbf7ea] lg:h-screen lg:overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-2 bg-[#c9a34a]" />
      <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:h-screen lg:min-h-0 lg:grid-cols-[minmax(280px,360px)_1fr] lg:px-8">
        <aside className="flex flex-col gap-5 lg:min-h-0 lg:overflow-y-auto lg:py-6 lg:pr-1">
          <div className="space-y-5 border-b border-[#f6e6bb]/20 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#d8b35c]">Scrum poker</p>
                <h1 className="mt-2 text-4xl font-semibold leading-tight text-white sm:text-5xl">
                  Ricky&apos;s poker{" "}
                  <span className="whitespace-nowrap">
                    app<span aria-hidden="true">{PLAYING_CARDS}</span>
                  </span>
                </h1>
              </div>
              {amsterdamTime ? (
                <time
                  aria-label="Amsterdam tijd"
                  className="shrink-0 rounded-md border border-[#f6e6bb]/30 bg-[#082c25] px-3 py-2 text-lg font-semibold tabular-nums text-[#f6e6bb]"
                >
                  {amsterdamTime}
                </time>
              ) : null}
            </div>
          </div>

          <form className="space-y-4" onSubmit={joinTable}>
            <label className="block text-sm font-medium text-[#f6e6bb]" htmlFor="name">
              Naam
            </label>
            <input
              id="name"
              className="w-full rounded-lg border border-[#f6e6bb]/30 bg-[#082c25] px-4 py-3 text-base text-white outline-none transition focus:border-[#d8b35c]"
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bijvoorbeeld Ricky"
              value={name}
            />

            <label className="block text-sm font-medium text-[#f6e6bb]" htmlFor="room">
              Tafel
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                id="room"
                className="min-w-0 rounded-lg border border-[#f6e6bb]/30 bg-[#082c25] px-4 py-3 text-base text-white outline-none transition focus:border-[#d8b35c]"
                maxLength={42}
                onChange={(event) => {
                  setAutoJoinFromLink(false);
                  setKickedRoomId("");
                  setRoomInput(event.target.value);
                }}
                value={roomInput}
              />
              <button
                className="rounded-lg bg-[#d8b35c] px-4 py-3 text-sm font-semibold text-[#14382f] transition hover:bg-[#f0ca73]"
                type="submit"
              >
                Aan tafel
              </button>
            </div>
          </form>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <button
              className="rounded-lg border border-[#f6e6bb]/30 px-4 py-3 text-left text-sm font-semibold text-[#fbf7ea] transition hover:border-[#d8b35c]"
              onClick={copyRoomLink}
              type="button"
            >
              {shareState}
            </button>
            <button
              className="rounded-lg border border-[#f6e6bb]/30 px-4 py-3 text-left text-sm font-semibold text-[#fbf7ea] transition hover:border-[#d8b35c]"
              onClick={() => {
                const created = `ricky-${Math.random().toString(36).slice(2, 7)}`;
                setAutoJoinFromLink(false);
                setKickedMessage("");
                setKickedRoomId("");
                setRoomInput(created);
                setRoom(null);
                setJoined(false);
                window.history.replaceState(null, "", `?room=${created}`);
              }}
              type="button"
            >
              Nieuwe tafel
            </button>
          </div>

          {error ? (
            <p className="rounded-lg border border-[#ffb4a8]/50 bg-[#711c32] px-4 py-3 text-sm text-[#ffe5dc]">
              {error}
            </p>
          ) : null}

          <section className="mt-auto border-t border-[#f6e6bb]/20 pt-5">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-[#a9cfc0]">Ronde</p>
                <p className="text-2xl font-semibold">{room?.round ?? 1}</p>
              </div>
              <div>
                <p className="text-xs text-[#a9cfc0]">Spelers</p>
                <p className="text-2xl font-semibold">{room?.players.length ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-[#a9cfc0]">Status</p>
                <p className="text-lg font-semibold">{room?.revealed ? "Open" : "Dicht"}</p>
              </div>
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col gap-4 py-2 lg:h-full lg:py-6">
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[1fr_280px]">
            <div className="flex min-h-0 flex-col rounded-lg border border-[#f6e6bb]/25 bg-[#0b3029] p-4 shadow-2xl shadow-black/25">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-[#a9cfc0]">Tafel</p>
                  <h2 className="text-2xl font-semibold text-white">{activeRoomId}</h2>
                </div>
                <div className="flex flex-nowrap gap-2 overflow-x-auto">
                  <button
                    className="whitespace-nowrap rounded-lg bg-[#8e2945] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#a93754] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!isLeader || room?.revealed || busyAction === "reveal"}
                    onClick={() => leaderAction("reveal")}
                    type="button"
                  >
                    omdraaien
                  </button>
                  <button
                    className="whitespace-nowrap rounded-lg border border-[#d8b35c]/70 px-3 py-2 text-sm font-semibold text-[#f6e6bb] transition hover:bg-[#d8b35c] hover:text-[#14382f] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!isLeader || !room?.revealed || busyAction === "reset"}
                    onClick={() => leaderAction("reset")}
                    type="button"
                  >
                    wissen
                  </button>
                  <button
                    className="whitespace-nowrap rounded-lg border border-[#f6e6bb]/50 px-3 py-2 text-sm font-semibold text-[#fbf7ea] transition hover:border-[#d8b35c] hover:bg-[#17483d] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={
                      !isLeader ||
                      !selectedPlayer ||
                      selectedPlayer.isLeader ||
                      busyAction === "makeLeader"
                    }
                    onClick={makeSelectedPlayerLeader}
                    type="button"
                  >
                    maak leider
                  </button>
                  <button
                    className="whitespace-nowrap rounded-lg border border-[#ffb4a8]/70 px-3 py-2 text-sm font-semibold text-[#ffd9d2] transition hover:bg-[#711c32] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={
                      !isLeader ||
                      !selectedPlayer ||
                      selectedPlayer.clientId === clientId ||
                      busyAction === "kick"
                    }
                    onClick={kickSelectedPlayer}
                    type="button"
                  >
                    Kick
                  </button>
                </div>
              </div>

              <div
                className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3"
                data-testid="players-grid"
              >
                {(room?.players ?? []).map((player) => {
                  const selected = selectedPlayerId === player.clientId;

                  return (
                  <article
                    className={`min-h-[132px] cursor-pointer rounded-lg border p-4 transition ${
                      selected
                        ? "border-[#d8b35c] bg-[#1f594b] shadow-lg shadow-black/20"
                        : "border-[#f6e6bb]/25 bg-[#17483d] hover:border-[#d8b35c]/80"
                    }`}
                    key={player.clientId}
                    onClick={() => setSelectedPlayerId(player.clientId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedPlayerId(player.clientId);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-lg font-semibold text-white">
                          {player.name}
                        </h3>
                        {selected ? (
                          <p className="mt-1 text-xs font-semibold text-[#f6e6bb]">
                            Geselecteerd
                          </p>
                        ) : null}
                      </div>
                      {player.isLeader ? (
                        <span
                          aria-label="Leider"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#d8b35c] text-lg text-[#14382f]"
                          title="Leider"
                        >
                          {CROWN}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-5 grid h-12 place-items-center rounded-md border border-[#f6e6bb]/25 bg-[#092820]">
                      <span className="text-2xl font-semibold text-[#f6e6bb]">
                        {room?.revealed ? displayVote(player.vote) : player.vote ? "Gestemd" : "Wacht"}
                      </span>
                    </div>
                  </article>
                  );
                })}

                {!room?.players.length ? (
                  <div className="rounded-lg border border-dashed border-[#f6e6bb]/30 p-6 text-sm text-[#d8eadf]">
                    Vul je naam in om de tafel te openen.
                  </div>
                ) : null}
              </div>
            </div>

            <aside className="min-h-0 overflow-y-auto rounded-lg border border-[#f6e6bb]/25 bg-[#082c25] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Uitslag</h2>
                {isLeader ? (
                  <span className="rounded-md bg-[#d8b35c] px-2 py-1 text-xs font-semibold text-[#14382f]">
                    {CROWN} Leider
                  </span>
                ) : null}
              </div>

              <div className="mt-5 grid gap-3">
                <div className="rounded-lg border border-[#f6e6bb]/20 p-4">
                  <p className="text-xs text-[#a9cfc0]">Mediaan</p>
                  <p className="mt-2 text-3xl font-semibold text-[#f6e6bb]">
                    {room?.revealed ? room.stats.median ?? "Geen" : "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-[#f6e6bb]/20 p-4">
                  <p className="text-xs text-[#a9cfc0]">Modus</p>
                  <p className="mt-2 break-words text-3xl font-semibold text-[#f6e6bb]">
                    {room?.revealed ? displayModes(room.stats.modes) : "-"}
                  </p>
                </div>
                <p className="text-sm leading-6 text-[#d8eadf]">
                  {room?.revealed
                    ? `${room.stats.numericVotes} numerieke stem${
                        room.stats.numericVotes === 1 ? "" : "men"
                      }`
                    : "De uitslag verschijnt na het omdraaien."}
                </p>
              </div>
            </aside>
          </div>

          <div
            className="shrink-0 rounded-lg border border-[#f6e6bb]/25 bg-[#fbf7ea] p-4 text-[#14382f]"
            data-testid="card-picker"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Kies je kaart</h2>
              <p className="text-sm font-medium text-[#4f776b]">
                {selectedVote ? `Gekozen: ${displayVote(selectedVote)}` : "Nog geen keuze"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-12">
              {CARD_VALUES.map((value) => {
                const active = selectedVote === value;
                const label = value === "coffee" ? COFFEE : value;

                return (
                  <button
                    className={`aspect-[3/4] rounded-lg border text-2xl font-semibold transition ${
                      active
                        ? "border-[#8e2945] bg-[#8e2945] text-white shadow-lg shadow-[#8e2945]/25"
                        : "border-[#d2c091] bg-white text-[#14382f] hover:border-[#8e2945]"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                    disabled={!canVote || busyAction === `vote-${value}`}
                    key={value}
                    onClick={() => chooseVote(value)}
                    title={value === "coffee" ? "Koffiepauze" : `Schatting ${value}`}
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
      {kickedMessage ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#031d18]/75 px-4">
          <div
            aria-modal="true"
            className="w-full max-w-sm rounded-lg border border-[#f6e6bb]/30 bg-[#082c25] p-6 text-center shadow-2xl shadow-black/40"
            role="alertdialog"
          >
            <p className="text-lg font-semibold text-white">{kickedMessage}</p>
            <button
              className="mt-5 rounded-lg bg-[#d8b35c] px-5 py-3 text-sm font-semibold text-[#14382f] transition hover:bg-[#f0ca73]"
              onClick={() => setKickedMessage("")}
              type="button"
            >
              Ok
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
