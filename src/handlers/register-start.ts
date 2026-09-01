import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { allGameIds, nextId, readTournament, type Player, type Team, writeTournament } from "../registrar.js";

registerMainMenuItem({ label: "Register team", data: "register:start", order: 10 });

const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
const typed = { force_reply: true, input_field_placeholder: "Type your answer" } as const;

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
  await ctx.reply("Enter your team name.", { reply_markup: typed });
}
export async function beginRegistration(ctx: Ctx, paidFlag = false): Promise<void> { await begin(ctx, paidFlag); }

composer.callbackQuery("register:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const records = await readTournament(ctx);
  if (!records) { await ctx.reply("Registration records aren't available yet. Try again shortly.", { reply_markup: back }); return; }
  const existing = records.teams.some((team) => team.captainTelegramId === ctx.from?.id && team.status !== "rejected");
  if (existing) { await ctx.reply("You already have a team registration. Ask the organizer to update it if needed.", { reply_markup: back }); return; }
  await begin(ctx, false);
});

composer.callbackQuery(/^register:count:(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const count = Number(ctx.match[1]);
  if (ctx.session.step !== "player_count" || count < 1 || count > 6) return;
  ctx.session.playerCount = count; ctx.session.players = []; ctx.session.step = "player";
  await ctx.reply(`Enter player 1 of ${count} as: game ID | nickname | role.`, { reply_markup: typed });
});
composer.callbackQuery("register:subs:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "substitute_choice") return;
  ctx.session.substitutes = []; ctx.session.step = "substitute";
  await ctx.reply("Enter a substitute as: game ID | nickname | role. Send Done when finished.", { reply_markup: typed });
});
composer.callbackQuery("register:subs:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "substitute_choice") return;
  ctx.session.substitutes = []; ctx.session.step = "registration_confirm";
  await ctx.reply("Review your registration, then confirm it.", { reply_markup: inlineKeyboard([[inlineButton("Confirm registration", "register:confirm")], [inlineButton("Cancel", "register:cancel")]]) });
});
composer.callbackQuery("register:cancel", async (ctx) => { await ctx.answerCallbackQuery(); clearDraft(ctx); await ctx.reply("Registration cancelled.", { reply_markup: back }); });

composer.callbackQuery("register:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "registration_confirm" || !ctx.from || !ctx.session.teamName || !ctx.session.captainPhone || !ctx.session.players?.length) return;
  const data = await readTournament(ctx);
  if (!data) { await ctx.reply("Registration records aren't available yet. Try again shortly."); return; }
  const team: Team = { id: nextId(data, "t"), teamName: ctx.session.teamName, captainTelegramId: ctx.from.id, captainPhone: ctx.session.captainPhone, players: ctx.session.players, substitutes: ctx.session.substitutes ?? [], paidFlag: ctx.session.paidFlag === true, status: "active", wins: 0, losses: 0, matchLinks: [] };
  const ids = allGameIds(team);
  const incumbent = data.teams.find((other) => other.status === "active" && allGameIds(other).some((id) => ids.includes(id)));
  if (incumbent) {
    team.status = "conflict"; data.teams.push(team);
    const conflict = { id: nextId(data, "c"), challengerId: team.id, incumbentId: incumbent.id, gameIds: allGameIds(incumbent).filter((id) => ids.includes(id)), resolved: false };
    data.conflicts.push(conflict);
    if (!(await writeTournament(ctx, data))) { await ctx.reply("Couldn't save this registration. Try again shortly."); return; }
    clearDraft(ctx);
    const owner = adminChatId(ctx as never);
    if (owner) { try { await ctx.api.sendMessage(owner, `Game ID conflict: ${team.teamName} conflicts with ${incumbent.teamName}. Open Admin desk to resolve it.`); } catch { /* A blocked admin notification must not undo the registration. */ } }
    await ctx.reply(owner ? "Your registration is pending an ID conflict review." : "Your registration is pending an ID conflict review. Owner notifications aren't set up yet.", { reply_markup: back });
    return;
  }
  data.teams.push(team);
  if (!(await writeTournament(ctx, data))) { await ctx.reply("Couldn't save this registration. Try again shortly."); return; }
  clearDraft(ctx);
  const owner = adminChatId(ctx as never);
  if (owner) { try { await ctx.api.sendMessage(owner, `New team registration: ${team.teamName}. Open Admin desk to manage the tournament.`); } catch { /* Notification delivery is best effort. */ } }
  await ctx.reply(owner ? "Your team is registered and active." : "Your team is registered and active. Owner notifications aren't set up yet.", { reply_markup: back });
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (!ctx.session.step) return next();
  if (text.toLocaleLowerCase() === "cancel") { clearDraft(ctx); await ctx.reply("Registration cancelled.", { reply_markup: back }); return; }
  if (ctx.session.step === "team_name") {
    if (text.length < 2 || text.length > 40) { await ctx.reply("Use a team name between 2 and 40 characters.", { reply_markup: typed }); return; }
    ctx.session.teamName = text; ctx.session.step = "captain_phone"; await ctx.reply("Enter a captain contact number.", { reply_markup: typed }); return;
  }
  if (ctx.session.step === "captain_phone") {
    if (!/^[+0-9()\-\s]{7,25}$/.test(text)) { await ctx.reply("Enter a valid contact number.", { reply_markup: typed }); return; }
    ctx.session.captainPhone = text; ctx.session.step = "player_count";
    await ctx.reply("How many starting players are registering?", { reply_markup: inlineKeyboard([[1, 2, 3].map((n) => inlineButton(String(n), `register:count:${n}`)), [4, 5, 6].map((n) => inlineButton(String(n), `register:count:${n}`))]) }); return;
  }
  if (ctx.session.step === "player") {
    const player = parsedPlayer(text); if (!player) { await ctx.reply("Use: game ID | nickname | role.", { reply_markup: typed }); return; }
    const players = ctx.session.players ?? []; if (players.some((item) => item.gameId.toLocaleLowerCase() === player.gameId.toLocaleLowerCase())) { await ctx.reply("That game ID is already on this team. Use a different one.", { reply_markup: typed }); return; }
    players.push(player); ctx.session.players = players;
    if (players.length < (ctx.session.playerCount ?? 1)) { await ctx.reply(`Enter player ${players.length + 1} of ${ctx.session.playerCount} as: game ID | nickname | role.`, { reply_markup: typed }); return; }
    ctx.session.step = "substitute_choice"; await ctx.reply("Do you want to add substitutes?", { reply_markup: inlineKeyboard([[inlineButton("Add substitute", "register:subs:yes")], [inlineButton("No substitutes", "register:subs:no")]]) }); return;
  }
  if (ctx.session.step === "substitute") {
    if (text.toLocaleLowerCase() === "done") { if (!(ctx.session.substitutes?.length)) { await ctx.reply("Add at least one substitute or tap No substitutes.", { reply_markup: typed }); return; } ctx.session.step = "registration_confirm"; await ctx.reply("Review your registration, then confirm it.", { reply_markup: inlineKeyboard([[inlineButton("Confirm registration", "register:confirm")], [inlineButton("Cancel", "register:cancel")]]) }); return; }
    const player = parsedPlayer(text); if (!player) { await ctx.reply("Use: game ID | nickname | role, or send Done.", { reply_markup: typed }); return; }
    const used = [...(ctx.session.players ?? []), ...(ctx.session.substitutes ?? [])]; if (used.some((item) => item.gameId.toLocaleLowerCase() === player.gameId.toLocaleLowerCase())) { await ctx.reply("That game ID is already on this team. Use a different one.", { reply_markup: typed }); return; }
    ctx.session.substitutes = [...(ctx.session.substitutes ?? []), player]; await ctx.reply("Substitute added. Add another or send Done.", { reply_markup: typed }); return;
  }
  return next();
});
export default composer;
