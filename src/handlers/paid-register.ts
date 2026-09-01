import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { readTournament } from "../registrar.js";
import { beginRegistration } from "./register-start.js";

registerMainMenuItem({ label: "Paid registration", data: "paid:register", order: 30 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);
composer.callbackQuery("paid:register", async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await readTournament(ctx);
  if (!data) { await ctx.reply("Paid registration isn't available yet. Try again shortly.", { reply_markup: back }); return; }
  if (!data.paid.enabled || !data.paid.price || !data.paid.paymentLink) { await ctx.reply("Paid registration isn't open right now.", { reply_markup: back }); return; }
  ctx.session.step = "paid_confirm";
  await ctx.reply(`Registration fee: ${data.paid.price}. Complete payment, then confirm here.`, { reply_markup: inlineKeyboard([[urlButton("Open payment", data.paid.paymentLink)], [inlineButton("Confirm payment", "paid:confirm")], [inlineButton("Back to menu", "menu:main")]]) });
});
composer.callbackQuery("paid:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "paid_confirm") return;
  await beginRegistration(ctx, true);
});
export default composer;
