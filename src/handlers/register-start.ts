import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { getPaid, saveTeam, teams, type Player, type Team } from "../registrar-data.js";

registerMainMenuItem({ label: "Register team", data: "register:start", order: 10 });
const composer = new Composer<Ctx>();
const form = (ctx: Ctx) => (ctx.session.registrar ??= {});
const typed = { force_reply: true as const, input_field_placeholder: "Type your answer" };
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

async function askTeam(ctx: Ctx, paid: boolean) {
  ctx.session.registrar = { step: "team", players: [], substitutes: [], paid };
  await ctx.reply("Send your team name.", { reply_markup: typed });
}
composer.callbackQuery("register:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const paid = await getPaid(ctx);
  if (paid.enabled) { await ctx.reply("Paid registration is enabled. Use Open paid registration to continue."); return; }
  const existing = (await teams(ctx)).find((t) => t.captainTelegramId === ctx.from?.id && t.status !== "rejected");
  if (existing) { await ctx.reply("You already have a team registered. Ask the organizer if it needs changing.", { reply_markup: back }); return; }
  await askTeam(ctx, false);
});
composer.callbackQuery("register:player", async (ctx) => { await ctx.answerCallbackQuery(); form(ctx).step = "player"; await ctx.reply("Send a player as: game ID, nickname, role.", { reply_markup: typed }); });
composer.callbackQuery("register:sub", async (ctx) => { await ctx.answerCallbackQuery(); form(ctx).step = "player"; form(ctx).addingSubstitute = true; await ctx.reply("Send a substitute as: game ID, nickname, role.", { reply_markup: typed }); });
composer.callbackQuery("register:finish", async (ctx) => {
  await ctx.answerCallbackQuery(); const f = form(ctx);
  if (!f.players?.length) { await ctx.reply("Add at least one player before you continue."); return; }
  f.step = "confirm";
  await ctx.reply(`Review your team: ${f.teamName}\nPlayers: ${f.players.length}\nSubstitutes: ${f.substitutes?.length ?? 0}`, { reply_markup: inlineKeyboard([[inlineButton("Confirm registration", "register:confirm")], [inlineButton("Add player", "register:player"), inlineButton("Back to menu", "menu:main")]]) });
});
composer.callbackQuery("register:confirm", async (ctx) => {
  await ctx.answerCallbackQuery(); const f = form(ctx);
  if (f.step !== "confirm" || !ctx.from || !f.teamName || !f.phone || !f.players?.length) { await ctx.reply("Your registration expired. Start again from the menu.", { reply_markup: back }); return; }
  const id = `${ctx.from.id}-${f.teamName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24)}`;
  const team: Team = { id, teamName: f.teamName, captainTelegramId: ctx.from.id, captainPhone: f.phone, players: f.players, substitutes: f.substitutes ?? [], paidFlag: Boolean(f.paid), status: "active", wins: 0, losses: 0, matchLinks: [] };
  const conflict = await saveTeam(ctx, team); ctx.session.registrar = {};
  const owner = adminChatId(ctx);
  if (owner) { try { await ctx.api.sendMessage(owner, conflict ? `Game ID conflict: ${team.teamName} is waiting for review against an active team. Open Manage tournament to choose the winner.` : `New team registration: ${team.teamName}. Players: ${team.players.length}.`); } catch { /* a blocked admin must not cancel registration */ } }
  if (conflict) await ctx.reply("Your registration is held for review because a game ID is already in use. The organizer will resolve it.", { reply_markup: back });
  else await ctx.reply(owner ? "Your team is registered and active." : "Your team is registered and active. Organizer notifications aren't set up yet.", { reply_markup: back });
});
composer.on("message:text", async (ctx, next) => {
  const f = form(ctx); const text = ctx.message.text.trim();
  if (!f.step) return next();
  if (f.step === "team") { if (text.length < 2 || text.length > 40) { await ctx.reply("Use a team name between 2 and 40 characters."); return; } f.teamName = text; f.step = "phone"; await ctx.reply("Send the captain's contact number.", { reply_markup: typed }); return; }
  if (f.step === "phone") { if (!/^[+0-9 ()-]{5,30}$/.test(text)) { await ctx.reply("Send a valid contact number, then try again."); return; } f.phone = text; f.step = "player"; await ctx.reply("Send the first player as: game ID, nickname, role.", { reply_markup: typed }); return; }
  if (f.step === "player") { const parts = text.split(",").map((p) => p.trim()); if (parts.length !== 3 || parts.some((p) => !p || p.length > 40)) { await ctx.reply("Use this format: game ID, nickname, role."); return; } const p: Player = { gameId: parts[0], nickname: parts[1], role: parts[2] }; const sub = f.addingSubstitute; delete f.addingSubstitute; (sub ? (f.substitutes ??= []) : (f.players ??= [])).push(p); await ctx.reply("Player saved. Add another player or review your team.", { reply_markup: inlineKeyboard([[inlineButton("Add player", "register:player"), inlineButton("Add substitute", "register:sub")], [inlineButton("Review team", "register:finish")]]) }); return; }
  return next();
});
export { askTeam };
export default composer;
