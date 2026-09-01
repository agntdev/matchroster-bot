import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { t } from "../i18n.js";

// /help — plain-language explanation for non-technical users. This bot is
// button-driven: tell the user to tap /start to open the menu rather than listing
// slash commands. The same text is shown when the user taps the Help button on the
// main menu (`menu:help`). Enhance the copy for your specific bot; keep it short.
const composer = new Composer<Ctx>();

const backToMenu = (ctx: Ctx) => inlineKeyboard([[inlineButton(t(ctx, "back"), "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(t(ctx, "help"));
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t(ctx, "help"), { reply_markup: backToMenu(ctx) });
});

export default composer;
