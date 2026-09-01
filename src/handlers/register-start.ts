import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { allGameIds, nextId, readTournament, type Player, type RegistrationDraft, type Team, writeTournament } from "../registrar.js";

registerMainMenuItem({ label: "Регистрация", data: "register:start", order: 10 });

const composer = new Composer<Ctx>();
const MAX_PLAYERS = 12;
const back = () => inlineKeyboard([[inlineButton("В меню", "menu:main")]]);
const actions = () => inlineKeyboard([
  [inlineButton("Отправить заявку", "register:form")],
  [inlineButton("Отмена", "register:cancel")],
]);

function clear(ctx: Ctx): void {
  delete ctx.session.step;
  delete ctx.session.registrationDraft;
  delete ctx.session.paidFlag;
}

function normalize(value: string): string { return value.trim().toLocaleLowerCase(); }
function validUsername(value: string): boolean { return /^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value); }
function validPhone(value: string): boolean { return /^\+\d{7,15}$/.test(value); }

/** The owner-approved template is also used in the admin preview. */
export function registrationTemplate(maxPlayers: number, paid: boolean): string {
  return [
    "Регистрационная форма",
    "",
    "1) Контакт @: @yourTelegram (example: @Captain123)",
    "2) Контакт +: +7xxxxxxxxxx (example: +79991234567)",
    "3) Название команды: TeamName",
    "4) Игроки (по одному в строке): player_id nickname (без роли). Пример: 123456789 PlayerNick",
    "",
    "Заполните поля выше и добавьте игроков следующими строками без роли.",
    `Добавьте от 1 до ${maxPlayers} игроков.`,
    ...(paid ? ["Подтверждение оплаты: номер операции или ссылка"] : []),
    "Отправьте заполненную форму одним сообщением.",
  ].join("\n");
}

function issue(field: string, message: string): string { return `⛔ ${field}: ${message}`; }

function parseForm(text: string, maxPlayers: number, paid: boolean): RegistrationDraft | string[] {
  const fields: Record<string, string> = {};
  const playerRows: string[] = [];
  let readingPlayers = false;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(?:4\)\s*)?игроки(?:\s|:|\(|$)/iu.test(line)) { readingPlayers = true; continue; }
    if (/^player_id\s+nickname$/i.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon > 0 && !line.includes("|") && !readingPlayers) {
      const key = normalize(line.slice(0, colon)).replace(/^\d+\)\s*/, "");
      fields[key] = line.slice(colon + 1).trim();
      readingPlayers = false;
    } else if (readingPlayers) playerRows.push(line);
  }

  const errors: string[] = [];
  const username = fields["контакт @"] ?? "";
  const phone = fields["контакт +"] ?? "";
  const teamName = fields["название команды"] ?? "";
  if (!validUsername(username)) errors.push(issue("Контакт @", "начните с @ и укажите корректный username"));
  if (!validPhone(phone)) errors.push(issue("Контакт +", "начните с + и используйте только цифры"));
  if (teamName.length < 2 || teamName.length > 40) errors.push(issue("Название команды", "укажите от 2 до 40 символов"));
  if (playerRows.length === 0) errors.push(issue("Игроки", "добавьте хотя бы одного игрока"));
  if (playerRows.length > maxPlayers) errors.push(issue("Игроки", `можно добавить не больше ${maxPlayers}`));

  const players: Player[] = [];
  for (const [index, row] of playerRows.entries()) {
    const match = /^(\S+)\s+(.+?)$/.exec(row);
    if (!match || !match[1] || !match[2]) {
      errors.push(issue(`Игрок ${index + 1}`, "используйте формат ID никнейм без роли"));
      continue;
    }
    players.push({ gameId: match[1], nickname: match[2].trim(), slot: index + 1 });
  }
  const ids = players.map((player) => normalize(player.gameId));
  if (new Set(ids).size !== ids.length) errors.push(issue("Игроки", "игровые ID не должны повторяться"));
  const paymentToken = fields["подтверждение оплаты"];
  if (paid && !paymentToken) errors.push(issue("Подтверждение оплаты", "укажите номер операции или ссылку"));
  if (errors.length) return errors;
  return {
    teamName, captainName: username, captainUsername: username, contactTelegram: username, captainPhone: phone,
    paymentToken, players, substitutes: [], paidFlag: paid,
  };
}

function summary(draft: RegistrationDraft): string {
  return [
    `Команда: ${draft.teamName}`,
    `Контакт @: ${draft.contactTelegram ?? draft.captainUsername}`,
    `Контакт +: ${draft.captainPhone}`,
    "Игроки:",
    ...draft.players.map((player) => `${player.gameId} | ${player.nickname}`),
    draft.paidFlag ? "Оплата подтверждена капитаном." : "",
  ].filter(Boolean).join("\n");
}

function csv(draft: RegistrationDraft): string {
  const esc = (value: string | undefined) => `"${(value ?? "").replaceAll("\"", "\"\"")}"`;
  return [
    "ContactTelegram,ContactPhone,TeamName,GameID,Nickname,Paid",
    ...draft.players.map((player) => [draft.contactTelegram ?? draft.captainUsername, draft.captainPhone, draft.teamName, player.gameId, player.nickname, draft.paidFlag ? "yes" : "no"].map(esc).join(",")),
  ].join("\n");
}

async function showForm(ctx: Ctx, paidFlag: boolean): Promise<void> {
  const data = await readTournament(ctx);
  const maxPlayers = Math.min(data?.paid.maxPlayers ?? 6, MAX_PLAYERS);
  clear(ctx);
  ctx.session.paidFlag = paidFlag;
  await ctx.reply(registrationTemplate(maxPlayers, paidFlag || data?.paid.enabled === true), { reply_markup: actions() });
}

export async function beginRegistration(ctx: Ctx, paidFlag = false): Promise<void> { await showForm(ctx, paidFlag); }

composer.callbackQuery("register:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = await readTournament(ctx);
  if (data?.teams.some((team) => team.captainTelegramId === ctx.from?.id && team.status !== "rejected")) {
    await ctx.reply("У вас уже есть регистрация команды. Для изменений обратитесь к организатору.", { reply_markup: back() });
    return;
  }
  await showForm(ctx, false);
});
composer.callbackQuery("register:form", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "registration_form";
  await ctx.reply("Отправьте заполненную форму одним сообщением. Неверные строки будут отмечены ⛔.", { reply_markup: { force_reply: true, input_field_placeholder: "Вставьте таблицу регистрации…" } });
});
composer.callbackQuery("register:edit", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "registration_form";
  await ctx.reply("Исправьте форму и отправьте её снова.", { reply_markup: { force_reply: true, input_field_placeholder: "Вставьте исправленную таблицу…" } });
});
composer.callbackQuery("register:cancel", async (ctx) => { await ctx.answerCallbackQuery(); clear(ctx); await ctx.reply("Регистрация отменена.", { reply_markup: back() }); });
composer.callbackQuery("register:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = ctx.session.registrationDraft;
  if (!draft || !ctx.from) return;
  const data = await readTournament(ctx);
  if (!data) { await ctx.reply("Данные регистрации пока недоступны. Попробуйте позже."); return; }
  const team: Team = { id: nextId(data, "t"), teamName: draft.teamName, captainTelegramId: ctx.from.id, captainPhone: draft.captainPhone, players: draft.players, substitutes: [], paidFlag: draft.paidFlag, captainName: draft.captainName, captainUsername: draft.captainUsername, contactTelegram: draft.contactTelegram, paymentToken: draft.paymentToken, status: "active", wins: 0, losses: 0, matchLinks: [] };
  const ids = allGameIds(team);
  const incumbent = data.teams.find((other) => other.status === "active" && allGameIds(other).some((id) => ids.includes(id)));
  if (incumbent) {
    team.status = "conflict";
    data.conflicts.push({ id: nextId(data, "c"), challengerId: team.id, incumbentId: incumbent.id, gameIds: allGameIds(incumbent).filter((id) => ids.includes(id)), resolved: false });
  }
  data.teams.push(team);
  if (!await writeTournament(ctx, data)) { await ctx.reply("Не удалось сохранить регистрацию. Попробуйте позже."); return; }
  clear(ctx);
  const owner = adminChatId(ctx as never);
  if (owner) try {
    await ctx.api.sendMessage(owner, `${incumbent ? "Конфликт игрового ID" : "Новая регистрация"}:\n${summary(draft)}`);
    await ctx.api.sendDocument(owner, new InputFile(new TextEncoder().encode(csv(draft)), "team-registration.csv"));
  } catch { /* A blocked owner notification must not undo a saved registration. */ }
  await ctx.reply(incumbent ? `Обнаружен конфликт игрового ID с командой «${incumbent.teamName}». Заявка отправлена на проверку.` : "Команда зарегистрирована и активна.", { reply_markup: back() });
});
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "registration_form") return next();
  const data = await readTournament(ctx);
  const maxPlayers = Math.min(data?.paid.maxPlayers ?? 6, MAX_PLAYERS);
  const parsed = parseForm(ctx.message.text, maxPlayers, data?.paid.enabled === true || ctx.session.paidFlag === true);
  if (Array.isArray(parsed)) {
    await ctx.reply(["Проверьте отмеченные поля:", ...parsed].join("\n"), { reply_markup: actions() });
    return;
  }
  const used = new Set(parsed.players.map((player) => normalize(player.gameId)));
  const conflicts = data?.teams.filter((team) => team.status === "active" && allGameIds(team).some((id) => used.has(id))) ?? [];
  ctx.session.registrationDraft = parsed;
  ctx.session.step = "registration_preview";
  await ctx.reply(`Проверьте заявку:\n${summary(parsed)}${conflicts.length ? `\n\nЕсть конфликт ID с: ${conflicts.map((team) => team.teamName).join(", ")}. Организатор выберет активную команду.` : ""}`, { reply_markup: inlineKeyboard([[inlineButton("Подтвердить регистрацию", "register:confirm")], [inlineButton("Исправить форму", "register:edit")], [inlineButton("Отмена", "register:cancel")]]) });
});

export default composer;
