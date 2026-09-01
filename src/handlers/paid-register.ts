import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { readTournament } from "../registrar.js";
import { beginRegistration } from "./register-start.js";
import { t } from "../i18n.js";

registerMainMenuItem({ label: "Paid registration", data: "paid:register", order: 30 });
const composer = new Composer<Ctx>();
const back = (ctx: Ctx) => inlineKeyboard([[inlineButton(t(ctx, "back"), "menu:main")]]);
composer.callbackQuery("paid:register", async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await readTournament(ctx);
  if (!data) { await ctx.reply(t(ctx, "paid.unavailable"), { reply_markup: back(ctx) }); return; }
  if (!data.paid.enabled || !data.paid.price || !data.paid.paymentLink) { await ctx.reply(t(ctx, "paid.closed"), { reply_markup: back(ctx) }); return; }
  ctx.session.step = "paid_confirm";
  await ctx.reply(t(ctx, "paid.instructions", { price: data.paid.price }), { reply_markup: inlineKeyboard([[urlButton(t(ctx, "paid.open"), data.paid.paymentLink)], [inlineButton(t(ctx, "paid.confirm"), "paid:confirm")], [inlineButton(t(ctx, "back"), "menu:main")]]) });
});
composer.callbackQuery("paid:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "paid_confirm") return;
  await beginRegistration(ctx, true);
});
export default composer;
