import type { Ctx } from "./bot.js";

export interface Player { gameId: string; nickname: string; role: string }
export interface Team {
  id: string; teamName: string; captainTelegramId: number; captainPhone: string;
  players: Player[]; substitutes: Player[]; paidFlag: boolean; status: "active" | "pending" | "rejected";
  wins: number; losses: number; matchLinks: string[];
}
export interface Conflict { id: string; newTeamId: string; existingTeamIds: string[]; resolved: boolean }
export interface PaidSettings { enabled: boolean; price?: string; paymentLink?: string }
interface Data { teamIds: string[]; teams: Record<string, Team>; conflictIds: string[]; conflicts: Record<string, Conflict>; paid: PaidSettings }

const empty = (): Data => ({ teamIds: [], teams: {}, conflictIds: [], conflicts: {}, paid: { enabled: false } });
const key = "esports:registrar:data";

type DomainEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> } } };
async function workerData(ctx: Ctx): Promise<{ read(): Promise<Data | undefined>; write(value: Data): Promise<void> } | undefined> {
  const env = (ctx as Ctx & { env?: DomainEnv }).env;
  if (!env?.CHAT_DO) return undefined;
  const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("esports-registrar"));
  return {
    async read() { const r = await stub.fetch("https://do/data/" + key); return r.status === 204 ? undefined : (await r.json() as Data); },
    async write(value) { await stub.fetch("https://do/data/" + key, { method: "PUT", body: JSON.stringify(value) }); },
  };
}

/** Shared durable records. The session fallback exists solely for tokenless replay; Workers use ChatDO storage. */
async function withData<T>(ctx: Ctx, change: (data: Data) => Promise<T> | T): Promise<T> {
  const durable = await workerData(ctx);
  if (durable) {
    const data = (await durable.read()) ?? empty();
    const result = await change(data);
    await durable.write(data);
    return result;
  }
  const holder = ctx.session as Ctx["session"] & { __registrarTestData?: Data };
  const data = holder.__registrarTestData ?? empty();
  const result = await change(data);
  holder.__registrarTestData = data;
  return result;
}

export const getPaid = (ctx: Ctx) => withData(ctx, (d) => ({ ...d.paid }));
export const updatePaid = (ctx: Ctx, change: (p: PaidSettings) => void) => withData(ctx, (d) => { change(d.paid); });
export const teams = (ctx: Ctx) => withData(ctx, (d) => d.teamIds.map((id) => d.teams[id]).filter((t): t is Team => Boolean(t)));
export const teamById = (ctx: Ctx, id: string) => withData(ctx, (d) => d.teams[id]);
export async function saveTeam(ctx: Ctx, team: Team): Promise<Conflict | undefined> {
  return withData(ctx, (d) => {
    const used = new Set(team.players.concat(team.substitutes).map((p) => p.gameId.toLowerCase()));
    const existing = d.teamIds.map((id) => d.teams[id]).filter((t) => t.status === "active" && t.players.concat(t.substitutes).some((p) => used.has(p.gameId.toLowerCase())));
    d.teams[team.id] = team; d.teamIds.push(team.id);
    if (!existing.length) return undefined;
    team.status = "pending";
    const conflict: Conflict = { id: `c${d.conflictIds.length + 1}`, newTeamId: team.id, existingTeamIds: existing.map((t) => t.id), resolved: false };
    d.conflicts[conflict.id] = conflict; d.conflictIds.push(conflict.id);
    return conflict;
  });
}
export const nextConflict = (ctx: Ctx) => withData(ctx, (d) => d.conflictIds.map((id) => d.conflicts[id]).find((c) => !c.resolved));
export const getConflict = (ctx: Ctx, id: string) => withData(ctx, (d) => d.conflicts[id]);
export const resolveConflict = (ctx: Ctx, id: string, winner: "new" | "existing") => withData(ctx, (d) => {
  const c = d.conflicts[id]; if (!c || c.resolved) return undefined;
  const incoming = d.teams[c.newTeamId];
  if (winner === "new") { incoming.status = "active"; c.existingTeamIds.forEach((teamId) => { d.teams[teamId].status = "rejected"; }); }
  else incoming.status = "rejected";
  c.resolved = true; return incoming;
});
export const recordMatch = (ctx: Ctx, winnerName: string, loserName: string, link: string) => withData(ctx, (d) => {
  const find = (name: string) => d.teamIds.map((id) => d.teams[id]).find((t) => t.status === "active" && t.teamName.toLowerCase() === name.toLowerCase());
  const winner = find(winnerName), loser = find(loserName);
  if (!winner || !loser || winner.id === loser.id) return false;
  winner.wins++; loser.losses++; if (link) { winner.matchLinks.push(link); loser.matchLinks.push(link); } return true;
});
