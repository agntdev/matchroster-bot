/** Durable tournament records, stored as one known document in a Worker Durable Object. */
export interface Player { gameId: string; nickname: string; role: string; }
export interface Team {
  id: string; teamName: string; captainTelegramId: number; captainPhone: string;
  players: Player[]; substitutes: Player[]; paidFlag: boolean;
  status: "active" | "conflict" | "rejected"; wins: number; losses: number; matchLinks: string[];
}
export interface Conflict { id: string; challengerId: string; incumbentId: string; gameIds: string[]; resolved: boolean; }
export interface PaidSettings { enabled: boolean; price: string; paymentLink: string; }
export interface TournamentData { nextId: number; teams: Team[]; conflicts: Conflict[]; paid: PaidSettings; }
type Stub = { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response> };
type DataEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): Stub } };

export function emptyTournament(): TournamentData {
  return { nextId: 1, teams: [], conflicts: [], paid: { enabled: false, price: "", paymentLink: "" } };
}
function stub(ctx: object): Stub | undefined {
  const namespace = (ctx as { env?: DataEnv }).env?.CHAT_DO;
  return namespace?.get(namespace.idFromName("esports-team-registrar"));
}
export async function readTournament(ctx: object): Promise<TournamentData | undefined> {
  const target = stub(ctx);
  if (!target) return undefined;
  const response = await target.fetch("https://do/data?key=esports-team-registrar", { method: "GET" });
  if (response.status === 204) return emptyTournament();
  return response.ok ? (await response.json()) as TournamentData : undefined;
}
export async function writeTournament(ctx: object, data: TournamentData): Promise<boolean> {
  const target = stub(ctx);
  if (!target) return false;
  const response = await target.fetch("https://do/data?key=esports-team-registrar", { method: "PUT", body: JSON.stringify(data) });
  return response.ok;
}
export function nextId(data: TournamentData, prefix: string): string { const id = `${prefix}${data.nextId}`; data.nextId += 1; return id; }
export function allGameIds(team: Pick<Team, "players" | "substitutes">): string[] {
  return [...team.players, ...team.substitutes].map((player) => player.gameId.toLocaleLowerCase());
}
