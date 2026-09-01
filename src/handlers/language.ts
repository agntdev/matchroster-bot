import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { t } from "../i18n.js";

registerMainMenuItem({ label: "Language", data: "language:open", order: 80 });
const composer = new Composer<Ctx>();
const keyboard = (ctx: Ctx) => inlineKeyboard([[inlineButton(t(ctx, "lang.ru"), "language:ru"), inlineButton(t(ctx, "lang.en"), "language:en")], [inlineButton(t(ctx, "back"), "menu:main")]]);
async function show(ctx: Ctx, edit: boolean) { if (edit) await ctx.editMessageText(t(ctx, "lang.choose"), { reply_markup: keyboard(ctx) }); else await ctx.reply(t(ctx, "lang.choose"), { reply_markup: keyboard(ctx) }); }
composer.callbackQuery("language:open", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, true); });
composer.callbackQuery(/^language:(ru|en)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.locale = ctx.match[1] as "ru" | "en"; await ctx.editMessageText(t(ctx, `lang.saved.${ctx.session.locale}`), { reply_markup: inlineKeyboard([[inlineButton(t(ctx, "back"), "menu:main")]]) }); });
export default composer;
