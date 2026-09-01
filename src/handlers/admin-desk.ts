import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { nextId, readTournament, writeTournament } from "../registrar.js";

registerMainMenuItem({ label: "Admin desk", data: "admin:desk", order: 90 });
const composer = new Composer<Ctx>();
const typed = { force_reply: true, input_field_placeholder: "Type your answer" } as const;
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
const menu = inlineKeyboard([
  [inlineButton("Resolve conflicts", "admin:conflict")],
  [inlineButton("Add match result", "admin:add_match")],
  [inlineButton("Paid registration", "admin:paid")],
  [inlineButton("Back to menu", "menu:main")],
]);
async function owner(ctx: Ctx): Promise<boolean> { return requireOwner(ctx as never); }
async function desk(ctx: Ctx): Promise<void> { await ctx.editMessageText("Manage registrations, results, and paid access.", { reply_markup: menu }); }
composer.callbackQuery("admin:desk", async (ctx) => { await ctx.answerCallbackQuery(); if (await owner(ctx)) await desk(ctx); });
composer.callbackQuery("admin:conflict", async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return;
  const data = await readTournament(ctx); if (!data) { await ctx.reply("Tournament records aren't available yet. Try again shortly."); return; }
  const conflict = data.conflicts.find((item) => !item.resolved);
  if (!conflict) { await ctx.editMessageText("No game ID conflicts need review.", { reply_markup: menu }); return; }
  const challenger = data.teams.find((team) => team.id === conflict.challengerId); const incumbent = data.teams.find((team) => team.id === conflict.incumbentId);
  if (!challenger || !incumbent) { await ctx.reply("That conflict record is incomplete. Try again shortly."); return; }
  ctx.session.step = "admin_conflict_choice"; ctx.session.conflictId = conflict.id;
  await ctx.reply(`Choose the active team for the shared game ID.\n1. ${incumbent.teamName}\n2. ${challenger.teamName}\n\nReply with 1 or 2.`, { reply_markup: typed });
});
composer.callbackQuery("admin:add_match", async (ctx) => {
  await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return;
  const data = await readTournament(ctx); if (!data) { await ctx.reply("Tournament records aren't available yet. Try again shortly."); return; }
  const active = data.teams.filter((team) => team.status === "active");
  if (active.length < 2) { await ctx.editMessageText("Add at least two active teams before recording a match.", { reply_markup: menu }); return; }
  await ctx.editMessageText("Choose the winning team.", { reply_markup: inlineKeyboard([...active.map((team) => [inlineButton(team.teamName, `admin:win:${team.id}`)]), [inlineButton("Back", "admin:desk")]]) });
});
composer.callbackQuery(/^admin:win:(t\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; ctx.session.matchWinnerId = ctx.match[1]; ctx.session.step = "admin_match_loser"; const data = await readTournament(ctx); const active = data?.teams.filter((team) => team.status === "active" && team.id !== ctx.session.matchWinnerId) ?? []; await ctx.editMessageText("Choose the losing team.", { reply_markup: inlineKeyboard(active.map((team) => [inlineButton(team.teamName, `admin:loss:${team.id}`)])) }); });
composer.callbackQuery(/^admin:loss:(t\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; if (ctx.session.step !== "admin_match_loser") return; ctx.session.matchLoserId = ctx.match[1]; ctx.session.step = "admin_match_link"; await ctx.reply("Enter the match link.", { reply_markup: typed }); });
composer.callbackQuery("admin:paid", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; const data = await readTournament(ctx); if (!data) { await ctx.reply("Tournament records aren't available yet. Try again shortly."); return; } await ctx.editMessageText(data.paid.enabled ? `Paid registration is on at ${data.paid.price}.` : "Paid registration is off.", { reply_markup: inlineKeyboard([[inlineButton(data.paid.enabled ? "Disable paid registration" : "Enable paid registration", "admin:paid:toggle")], [inlineButton("Set price and link", "admin:paid:set")], [inlineButton("Back", "admin:desk")]]) }); });
composer.callbackQuery("admin:paid:toggle", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; const data = await readTournament(ctx); if (!data) { await ctx.reply("Tournament records aren't available yet. Try again shortly."); return; } if (!data.paid.enabled && (!data.paid.price || !data.paid.paymentLink)) { await ctx.reply("Set a price and payment link before enabling paid registration."); return; } data.paid.enabled = !data.paid.enabled; await writeTournament(ctx, data); await ctx.reply(data.paid.enabled ? "Paid registration is now open." : "Paid registration is now closed.", { reply_markup: menu }); });
composer.callbackQuery("admin:paid:set", async (ctx) => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; ctx.session.step = "admin_paid_price"; await ctx.reply("Enter the registration price, including currency.", { reply_markup: typed }); });
composer.on("message:text", async (ctx, next) => {
  const adminSteps = ["admin_conflict_choice", "admin_match_link", "admin_paid_price", "admin_paid_link"];
  if (!adminSteps.includes(ctx.session.step ?? "")) return next();
  if (!(await owner(ctx))) return;
  const text = ctx.message.text.trim();
  if (ctx.session.step === "admin_conflict_choice") {
    if (text !== "1" && text !== "2") { await ctx.reply("Reply with 1 or 2.", { reply_markup: typed }); return; }
    const data = await readTournament(ctx); const conflict = data?.conflicts.find((item) => item.id === ctx.session.conflictId && !item.resolved);
    if (!data || !conflict) { await ctx.reply("That conflict is no longer available.", { reply_markup: menu }); return; }
    const winnerId = text === "1" ? conflict.incumbentId : conflict.challengerId; const loserId = text === "1" ? conflict.challengerId : conflict.incumbentId;
    const winner = data.teams.find((team) => team.id === winnerId); const loser = data.teams.find((team) => team.id === loserId); if (!winner || !loser) { await ctx.reply("That conflict record is incomplete. Try again shortly."); return; }
    winner.status = "active"; loser.status = "rejected"; conflict.resolved = true; await writeTournament(ctx, data); delete ctx.session.step; delete ctx.session.conflictId; await ctx.reply(`${winner.teamName} is active. ${loser.teamName} was not approved.`, { reply_markup: menu }); return;
  }
  if (ctx.session.step === "admin_match_link") {
    let link: URL; try { link = new URL(text); } catch { await ctx.reply("Enter a full match link starting with https://.", { reply_markup: typed }); return; } if (link.protocol !== "https:") { await ctx.reply("Enter a full match link starting with https://.", { reply_markup: typed }); return; }
    const data = await readTournament(ctx); const winner = data?.teams.find((team) => team.id === ctx.session.matchWinnerId); const loser = data?.teams.find((team) => team.id === ctx.session.matchLoserId); if (!data || !winner || !loser) { await ctx.reply("Those teams are no longer available.", { reply_markup: menu }); return; }
    winner.wins += 1; loser.losses += 1; winner.matchLinks.push(link.toString()); loser.matchLinks.push(link.toString()); nextId(data, "m"); await writeTournament(ctx, data); delete ctx.session.step; delete ctx.session.matchWinnerId; delete ctx.session.matchLoserId; await ctx.reply("Match result is live in the table.", { reply_markup: menu }); return;
  }
  if (ctx.session.step === "admin_paid_price") { if (text.length < 1 || text.length > 40) { await ctx.reply("Enter a short price, including currency.", { reply_markup: typed }); return; } ctx.session.paidPrice = text; ctx.session.step = "admin_paid_link"; await ctx.reply("Enter the secure payment confirmation link.", { reply_markup: typed }); return; }
  if (ctx.session.step === "admin_paid_link") { let link: URL; try { link = new URL(text); } catch { await ctx.reply("Enter a full link starting with https://.", { reply_markup: typed }); return; } if (link.protocol !== "https:") { await ctx.reply("Enter a full link starting with https://.", { reply_markup: typed }); return; } const data = await readTournament(ctx); if (!data) { await ctx.reply("Tournament records aren't available yet. Try again shortly."); return; } data.paid.price = ctx.session.paidPrice ?? ""; data.paid.paymentLink = link.toString(); await writeTournament(ctx, data); delete ctx.session.step; delete ctx.session.paidPrice; await ctx.reply("Payment details saved. Enable paid registration when you're ready.", { reply_markup: menu }); return; }
  return next();
});
export default composer;
