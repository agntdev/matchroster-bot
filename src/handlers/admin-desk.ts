import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { nextId, readTournament, writeTournament } from "../registrar.js";
import { t, typed } from "../i18n.js";

registerMainMenuItem({ label: "Admin desk", data: "admin:desk", order: 90 });
const composer = new Composer<Ctx>();
const back = (ctx: Ctx) => inlineKeyboard([[inlineButton(t(ctx, "back"), "menu:main")]]);
const menu = (ctx: Ctx) => inlineKeyboard([[inlineButton(t(ctx, "admin.conflicts"), "admin:conflict")], [inlineButton(t(ctx, "admin.match"), "admin:add_match")], [inlineButton(t(ctx, "admin.paid"), "admin:paid")], [inlineButton(t(ctx, "back"), "menu:main")]]);
const owner = (ctx: Ctx) => requireOwner(ctx as never);
const unavailable = (ctx: Ctx) => ctx.reply(t(ctx, "unavailable.records"));
const teamDetails = (team: { teamName: string; contactTelegram?: string; captainUsername?: string; captainPhone: string; players: { gameId: string; nickname: string }[] }) =>
  `${team.teamName}\nКонтакт @: ${team.contactTelegram ?? team.captainUsername ?? "не указан"}\nКонтакт +: ${team.captainPhone || "не указан"}\nИгроки: ${team.players.map((player) => `${player.gameId} | ${player.nickname}`).join(", ")}`;

composer.callbackQuery("admin:desk", async ctx => { await ctx.answerCallbackQuery(); if (await owner(ctx)) await ctx.editMessageText(t(ctx, "admin.desk"), { reply_markup: menu(ctx) }); });
composer.callbackQuery("admin:conflict", async ctx => {
  await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; const data = await readTournament(ctx); if (!data) return unavailable(ctx);
  const conflict = data.conflicts.find(item => !item.resolved); if (!conflict) return ctx.editMessageText(t(ctx, "admin.no.conflicts"), { reply_markup: menu(ctx) });
  const challenger = data.teams.find(team => team.id === conflict.challengerId), incumbent = data.teams.find(team => team.id === conflict.incumbentId);
  if (!challenger || !incumbent) return ctx.reply(t(ctx, "admin.conflict.incomplete"));
  ctx.session.step = "admin_conflict_choice"; ctx.session.conflictId = conflict.id;
  await ctx.reply(`${t(ctx, "admin.conflict.choose", { one: incumbent.teamName, two: challenger.teamName, ids: conflict.gameIds.join(", ") })}\n\n1. ${teamDetails(incumbent)}\n\n2. ${teamDetails(challenger)}`, { reply_markup: typed(ctx) });
});
composer.callbackQuery("admin:add_match", async ctx => {
  await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; const data = await readTournament(ctx); if (!data) return unavailable(ctx);
  const active = data.teams.filter(team => team.status === "active"); if (active.length < 2) return ctx.editMessageText(t(ctx, "admin.need.teams"), { reply_markup: menu(ctx) });
  await ctx.editMessageText(t(ctx, "admin.winner"), { reply_markup: inlineKeyboard([...active.map(team => [inlineButton(team.teamName, `admin:win:${team.id}`)]), [inlineButton(t(ctx, "back"), "admin:desk")]]) });
});
composer.callbackQuery(/^admin:win:(t\d+)$/, async ctx => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; ctx.session.matchWinnerId = ctx.match[1]; ctx.session.step = "admin_match_loser"; const data = await readTournament(ctx); const active = data?.teams.filter(team => team.status === "active" && team.id !== ctx.session.matchWinnerId) ?? []; await ctx.editMessageText(t(ctx, "admin.loser"), { reply_markup: inlineKeyboard(active.map(team => [inlineButton(team.teamName, `admin:loss:${team.id}`)])) }); });
composer.callbackQuery(/^admin:loss:(t\d+)$/, async ctx => { await ctx.answerCallbackQuery(); if (!(await owner(ctx)) || ctx.session.step !== "admin_match_loser") return; ctx.session.matchLoserId = ctx.match[1]; ctx.session.step = "admin_match_link"; await ctx.reply(t(ctx, "admin.link"), { reply_markup: typed(ctx) }); });
composer.callbackQuery("admin:paid", async ctx => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; const data = await readTournament(ctx); if (!data) return unavailable(ctx); await ctx.editMessageText(data.paid.enabled ? t(ctx, "admin.paid.on", { price: data.paid.price }) : t(ctx, "admin.paid.off"), { reply_markup: inlineKeyboard([[inlineButton(t(ctx, data.paid.enabled ? "admin.paid.disable" : "admin.paid.enable"), "admin:paid:toggle")], [inlineButton(t(ctx, "admin.paid.set"), "admin:paid:set")], [inlineButton(t(ctx, "back"), "admin:desk")]]) }); });
composer.callbackQuery("admin:paid:toggle", async ctx => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; const data = await readTournament(ctx); if (!data) return unavailable(ctx); if (!data.paid.enabled && (!data.paid.price || !data.paid.paymentLink)) return ctx.reply(t(ctx, "admin.paid.need.details")); data.paid.enabled = !data.paid.enabled; await writeTournament(ctx, data); await ctx.reply(t(ctx, data.paid.enabled ? "admin.paid.opened" : "admin.paid.closed"), { reply_markup: menu(ctx) }); });
composer.callbackQuery("admin:paid:set", async ctx => { await ctx.answerCallbackQuery(); if (!(await owner(ctx))) return; ctx.session.step = "admin_paid_price"; await ctx.reply(t(ctx, "admin.price"), { reply_markup: typed(ctx) }); });
composer.on("message:text", async (ctx, next) => {
  if (!(["admin_conflict_choice", "admin_match_link", "admin_paid_price", "admin_paid_link"] as const).includes(ctx.session.step as never)) return next(); if (!(await owner(ctx))) return;
  const text = ctx.message.text.trim();
  if (ctx.session.step === "admin_conflict_choice") { if (text !== "1" && text !== "2") return ctx.reply(t(ctx, "admin.reply.choice"), { reply_markup: typed(ctx) }); const data = await readTournament(ctx), conflict = data?.conflicts.find(item => item.id === ctx.session.conflictId && !item.resolved); if (!data || !conflict) return ctx.reply(t(ctx, "admin.conflict.gone"), { reply_markup: menu(ctx) }); const winnerId = text === "1" ? conflict.incumbentId : conflict.challengerId, loserId = text === "1" ? conflict.challengerId : conflict.incumbentId, winner = data.teams.find(team => team.id === winnerId), loser = data.teams.find(team => team.id === loserId); if (!winner || !loser) return ctx.reply(t(ctx, "admin.conflict.incomplete")); winner.status = "active"; loser.status = "rejected"; conflict.resolved = true; await writeTournament(ctx, data); delete ctx.session.step; delete ctx.session.conflictId; return ctx.reply(t(ctx, "admin.conflict.resolved", { winner: winner.teamName, loser: loser.teamName }), { reply_markup: menu(ctx) }); }
  if (ctx.session.step === "admin_match_link") { let link: URL; try { link = new URL(text); } catch { return ctx.reply(t(ctx, "admin.link.invalid"), { reply_markup: typed(ctx) }); } if (link.protocol !== "https:") return ctx.reply(t(ctx, "admin.link.invalid"), { reply_markup: typed(ctx) }); const data = await readTournament(ctx), winner = data?.teams.find(team => team.id === ctx.session.matchWinnerId), loser = data?.teams.find(team => team.id === ctx.session.matchLoserId); if (!data || !winner || !loser) return ctx.reply(t(ctx, "admin.teams.gone"), { reply_markup: menu(ctx) }); winner.wins++; loser.losses++; winner.matchLinks.push(link.toString()); loser.matchLinks.push(link.toString()); nextId(data, "m"); await writeTournament(ctx, data); delete ctx.session.step; delete ctx.session.matchWinnerId; delete ctx.session.matchLoserId; return ctx.reply(t(ctx, "admin.match.live"), { reply_markup: menu(ctx) }); }
  if (ctx.session.step === "admin_paid_price") { if (text.length < 1 || text.length > 40) return ctx.reply(t(ctx, "admin.price.invalid"), { reply_markup: typed(ctx) }); ctx.session.paidPrice = text; ctx.session.step = "admin_paid_link"; return ctx.reply(t(ctx, "admin.payment.link"), { reply_markup: typed(ctx) }); }
  let link: URL; try { link = new URL(text); } catch { return ctx.reply(t(ctx, "admin.link.invalid.generic"), { reply_markup: typed(ctx) }); } if (link.protocol !== "https:") return ctx.reply(t(ctx, "admin.link.invalid.generic"), { reply_markup: typed(ctx) }); const data = await readTournament(ctx); if (!data) return unavailable(ctx); data.paid.price = ctx.session.paidPrice ?? ""; data.paid.paymentLink = link.toString(); await writeTournament(ctx, data); delete ctx.session.step; delete ctx.session.paidPrice; return ctx.reply(t(ctx, "admin.payment.saved"), { reply_markup: menu(ctx) });
});
export default composer;
