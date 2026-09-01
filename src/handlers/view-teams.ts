import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { readTournament } from "../registrar.js";

registerMainMenuItem({ label: "Teams and table", data: "view:teams", order: 20 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

export async function showTeams(ctx: Ctx, edit = true): Promise<void> {
  const data = await readTournament(ctx);
  if (!data) { await ctx.reply("Tournament records aren't available yet. Try again shortly.", { reply_markup: back }); return; }
  const active = data.teams.filter((team) => team.status === "active").sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.teamName.localeCompare(b.teamName));
  const text = active.length === 0
    ? "No registered teams yet — tap Register team to add one."
    : `Teams and standings\n\n${active.map((team, index) => `${index + 1}. ${team.teamName} — ${team.wins}W / ${team.losses}L${team.matchLinks.length ? `\nMatch: ${team.matchLinks[team.matchLinks.length - 1]}` : ""}`).join("\n\n")}`;
  if (edit) await ctx.editMessageText(text, { reply_markup: back });
  else await ctx.reply(text, { reply_markup: back });
}
composer.callbackQuery("view:teams", async (ctx) => { await ctx.answerCallbackQuery(); await showTeams(ctx); });
export default composer;
