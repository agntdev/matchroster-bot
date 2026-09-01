import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { allGameIds, nextId, readTournament, type Player, type Team, writeTournament } from "../registrar.js";
import { locale, t, typed } from "../i18n.js";

registerMainMenuItem({ label: "Register team", data: "register:start", order: 10 });

const composer = new Composer<Ctx>();
const back = (ctx: Ctx) => inlineKeyboard([[inlineButton(t(ctx, "back"), "menu:main")]]);

function clearDraft(ctx: Ctx): void {
  delete ctx.session.step; delete ctx.session.teamName; delete ctx.session.captainPhone;
  delete ctx.session.playerCount; delete ctx.session.players; delete ctx.session.substitutes; delete ctx.session.paidFlag;
}
function parsedPlayer(text: string): Player | undefined {
  const parts = text.split("|").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => part.length < 2 || part.length > 40)) return undefined;
  return { gameId: parts[0], nickname: parts[1], role: parts[2] };
}
async function begin(ctx: Ctx, paidFlag: boolean): Promise<void> {
  clearDraft(ctx); ctx.session.paidFlag = paidFlag; ctx.session.step = "team_name";
  await ctx.reply(t(ctx, "register.team"), { reply_markup: typed(ctx) });
}
export async function beginRegistration(ctx: Ctx, paidFlag = false): Promise<void> { await begin(ctx, paidFlag); }

composer.callbackQuery("register:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const records = await readTournament(ctx);
  if (!records) { await ctx.reply(t(ctx, "register.unavailable"), { reply_markup: back(ctx) }); return; }
  const existing = records.teams.some((team) => team.captainTelegramId === ctx.from?.id && team.status !== "rejected");
  if (existing) { await ctx.reply(t(ctx, "register.existing"), { reply_markup: back(ctx) }); return; }
  await begin(ctx, false);
});

composer.callbackQuery(/^register:count:(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const count = Number(ctx.match[1]);
  if (ctx.session.step !== "player_count" || count < 1 || count > 6) return;
  ctx.session.playerCount = count; ctx.session.players = []; ctx.session.step = "player";
  await ctx.reply(t(ctx, "register.player", { n: 1, total: count }), { reply_markup: typed(ctx) });
});
composer.callbackQuery("register:subs:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "substitute_choice") return;
  ctx.session.substitutes = []; ctx.session.step = "substitute";
  await ctx.reply(t(ctx, "register.sub"), { reply_markup: typed(ctx) });
});
composer.callbackQuery("register:subs:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "substitute_choice") return;
  ctx.session.substitutes = []; ctx.session.step = "registration_confirm";
  await ctx.reply(t(ctx, "register.review"), { reply_markup: inlineKeyboard([[inlineButton(t(ctx, "confirm"), "register:confirm")], [inlineButton(t(ctx, "cancel"), "register:cancel")]]) });
});
composer.callbackQuery("register:cancel", async (ctx) => { await ctx.answerCallbackQuery(); clearDraft(ctx); await ctx.reply(t(ctx, "register.cancelled"), { reply_markup: back(ctx) }); });

composer.callbackQuery("register:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "registration_confirm" || !ctx.from || !ctx.session.teamName || !ctx.session.captainPhone || !ctx.session.players?.length) return;
  const data = await readTournament(ctx);
  if (!data) { await ctx.reply(t(ctx, "register.unavailable")); return; }
  const team: Team = { id: nextId(data, "t"), teamName: ctx.session.teamName, captainTelegramId: ctx.from.id, captainPhone: ctx.session.captainPhone, players: ctx.session.players, substitutes: ctx.session.substitutes ?? [], paidFlag: ctx.session.paidFlag === true, status: "active", wins: 0, losses: 0, matchLinks: [] };
  const ids = allGameIds(team);
  const incumbent = data.teams.find((other) => other.status === "active" && allGameIds(other).some((id) => ids.includes(id)));
  if (incumbent) {
    team.status = "conflict"; data.teams.push(team);
    const conflict = { id: nextId(data, "c"), challengerId: team.id, incumbentId: incumbent.id, gameIds: allGameIds(incumbent).filter((id) => ids.includes(id)), resolved: false };
    data.conflicts.push(conflict);
    if (!(await writeTournament(ctx, data))) { await ctx.reply(t(ctx, "register.save.error")); return; }
    clearDraft(ctx);
    const owner = adminChatId(ctx as never);
    if (owner) { try { await ctx.api.sendMessage(owner, t(ctx, "notify.conflict", { team: team.teamName, other: incumbent.teamName })); } catch { /* A blocked admin notification must not undo the registration. */ } }
    await ctx.reply(owner ? t(ctx, "register.pending") : `${t(ctx, "register.pending")} ${t(ctx, "register.owner.unset")}`, { reply_markup: back(ctx) });
    return;
  }
  data.teams.push(team);
  if (!(await writeTournament(ctx, data))) { await ctx.reply(t(ctx, "register.save.error")); return; }
  clearDraft(ctx);
  const owner = adminChatId(ctx as never);
  if (owner) { try { await ctx.api.sendMessage(owner, t(ctx, "notify.team", { team: team.teamName })); } catch { /* Notification delivery is best effort. */ } }
  await ctx.reply(owner ? t(ctx, "register.saved") : `${t(ctx, "register.saved")} ${t(ctx, "register.owner.unset")}`, { reply_markup: back(ctx) });
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (!ctx.session.step) return next();
  if (["cancel", "отмена"].includes(text.toLocaleLowerCase())) { clearDraft(ctx); await ctx.reply(t(ctx, "register.cancelled"), { reply_markup: back(ctx) }); return; }
  if (ctx.session.step === "team_name") {
    if (text.length < 2 || text.length > 40) { await ctx.reply(t(ctx, "register.name.invalid"), { reply_markup: typed(ctx) }); return; }
    ctx.session.teamName = text; ctx.session.step = "captain_phone"; await ctx.reply(t(ctx, "register.phone"), { reply_markup: typed(ctx) }); return;
  }
  if (ctx.session.step === "captain_phone") {
    if (!/^[+0-9()\-\s]{7,25}$/.test(text)) { await ctx.reply(t(ctx, "register.phone.invalid"), { reply_markup: typed(ctx) }); return; }
    ctx.session.captainPhone = text; ctx.session.step = "player_count";
    await ctx.reply(t(ctx, "register.count"), { reply_markup: inlineKeyboard([[1, 2, 3].map((n) => inlineButton(String(n), `register:count:${n}`)), [4, 5, 6].map((n) => inlineButton(String(n), `register:count:${n}`))]) }); return;
  }
  if (ctx.session.step === "player") {
    const player = parsedPlayer(text); if (!player) { await ctx.reply(t(ctx, "register.player.format"), { reply_markup: typed(ctx) }); return; }
    const players = ctx.session.players ?? []; if (players.some((item) => item.gameId.toLocaleLowerCase() === player.gameId.toLocaleLowerCase())) { await ctx.reply(t(ctx, "register.player.duplicate"), { reply_markup: typed(ctx) }); return; }
    players.push(player); ctx.session.players = players;
    if (players.length < (ctx.session.playerCount ?? 1)) { await ctx.reply(t(ctx, "register.player", { n: players.length + 1, total: ctx.session.playerCount ?? 1 }), { reply_markup: typed(ctx) }); return; }
    ctx.session.step = "substitute_choice"; await ctx.reply(t(ctx, "register.subs.ask"), { reply_markup: inlineKeyboard([[inlineButton(t(ctx, "register.subs.yes"), "register:subs:yes")], [inlineButton(t(ctx, "register.subs.no"), "register:subs:no")]]) }); return;
  }
  if (ctx.session.step === "substitute") {
    if (["done", "готово"].includes(text.toLocaleLowerCase())) { if (!(ctx.session.substitutes?.length)) { await ctx.reply(t(ctx, "register.sub.required"), { reply_markup: typed(ctx) }); return; } ctx.session.step = "registration_confirm"; await ctx.reply(t(ctx, "register.review"), { reply_markup: inlineKeyboard([[inlineButton(t(ctx, "confirm"), "register:confirm")], [inlineButton(t(ctx, "cancel"), "register:cancel")]]) }); return; }
    const player = parsedPlayer(text); if (!player) { await ctx.reply(t(ctx, "register.sub.format"), { reply_markup: typed(ctx) }); return; }
    const used = [...(ctx.session.players ?? []), ...(ctx.session.substitutes ?? [])]; if (used.some((item) => item.gameId.toLocaleLowerCase() === player.gameId.toLocaleLowerCase())) { await ctx.reply(t(ctx, "register.player.duplicate"), { reply_markup: typed(ctx) }); return; }
    ctx.session.substitutes = [...(ctx.session.substitutes ?? []), player]; await ctx.reply(t(ctx, "register.sub.added"), { reply_markup: typed(ctx) }); return;
  }
  return next();
});
export default composer;
