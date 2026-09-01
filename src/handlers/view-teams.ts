import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { teams } from "../registrar-data.js";
registerMainMenuItem({ label: "View teams & table", data: "view:teams", order: 20 });
const composer = new Composer<Ctx>();
async function render(ctx: Ctx, edit = false) {
  const active = (await teams(ctx)).filter((t) => t.status === "active").sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.teamName.localeCompare(b.teamName));
  const text = active.length ? "Registered teams and live table:\n" + active.map((t, i) => `${i + 1}. ${t.teamName} — ${t.wins}W / ${t.losses}L${t.matchLinks.length ? ` · ${t.matchLinks[t.matchLinks.length - 1]}` : ""}`).join("\n") : "No teams are registered yet — tap Register team to add one.";
  const opts = { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) };
  if (edit) await ctx.editMessageText(text, opts); else await ctx.reply(text, opts);
}
composer.callbackQuery("view:teams", async (ctx) => { await ctx.answerCallbackQuery(); await render(ctx); });
export { render as renderTeams };
export default composer;
