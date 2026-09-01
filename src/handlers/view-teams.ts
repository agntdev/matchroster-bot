import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { readTournament } from "../registrar.js";
import { locale, t } from "../i18n.js";

registerMainMenuItem({ label: "Teams and table", data: "view:teams", order: 20 });
const composer = new Composer<Ctx>();
const back = (ctx: Ctx) => inlineKeyboard([[inlineButton(t(ctx, "back"), "menu:main")]]);

export async function showTeams(ctx: Ctx, edit = true): Promise<void> {
  const data = await readTournament(ctx);
  if (!data) { await ctx.reply(t(ctx, "unavailable.records"), { reply_markup: back(ctx) }); return; }
  const active = data.teams.filter((team) => team.status === "active").sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.teamName.localeCompare(b.teamName, locale(ctx)));
  const text = active.length === 0
    ? t(ctx, "teams.empty")
    : `${t(ctx, "teams.title")}\n\n${active.map((team, index) => `${index + 1}. ${team.teamName} — ${t(ctx, "teams.line", { wins: team.wins, losses: team.losses })}${team.matchLinks.length ? `\n${t(ctx, "teams.match")}: ${team.matchLinks[team.matchLinks.length - 1]}` : ""}`).join("\n\n")}`;
  if (edit) await ctx.editMessageText(text, { reply_markup: back(ctx) });
  else await ctx.reply(text, { reply_markup: back(ctx) });
}
composer.callbackQuery("view:teams", async (ctx) => { await ctx.answerCallbackQuery(); await showTeams(ctx); });
export default composer;
