import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { allGameIds, nextId, readTournament, type Player, type RegistrationDraft, type Team, writeTournament } from "../registrar.js";

registerMainMenuItem({ label: "Регистрация", data: "register:start", order: 10 });
const composer = new Composer<Ctx>();
const back = () => inlineKeyboard([[inlineButton("В меню", "menu:main")]]);
const controls = () => inlineKeyboard([
  [inlineButton("Получить CSV-шаблон", "register:template")],
  [inlineButton("Отправить заполненную форму", "register:form")],
  [inlineButton("Отмена", "register:cancel")],
]);
const csvHeaders = "Номер слота,ФИО игрока,Игровой ник,Игровой ID,Контакт\n1,,,,\n";
const form = (paid: boolean, clan: boolean, maxPlayers: number, maxSubs: number) => [
  "Заполните форму одним сообщением. Поля со звёздочкой обязательны.",
  "Команда*: Название", clan ? "Клан: Название или тег" : "", clan ? "Команд клана: 1" : "",
  "Капитан*: ФИО", "Username капитана: @username", "Контакт: телефон или Discord", "ID капитана: игровой ID",
  paid ? "Подтверждение оплаты*: номер операции или ссылка" : "",
  "Игроки* — по одной строке: номер | ФИО | ник | игровой ID | контакт",
  "1 | Иван Иванов | PlayerOne | game-123 | @discord",
  maxSubs > 0 ? "Запасные — тот же формат, после строки «Запасные:»" : "",
  "До " + maxPlayers + " игроков" + (maxSubs > 0 ? " и " + maxSubs + " запасных" : "") + ". Вставьте таблицу или отправьте CSV.",
].filter(Boolean).join("\n");

function clear(ctx: Ctx) { delete ctx.session.step; delete ctx.session.registrationDraft; delete ctx.session.paidFlag; }
function norm(value: string) { return value.trim().toLocaleLowerCase(); }
function parseRows(lines: string[], max: number): Player[] | undefined {
  const rows: Player[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("|").map(x => x.trim());
    if (parts.length < 4 || parts.length > 5 || !parts[1] || !parts[2] || !parts[3]) return undefined;
    const slot = Number(parts[0]);
    if (!Number.isInteger(slot) || slot < 1 || slot > max) return undefined;
    if (rows.some(p => p.slot === slot || norm(p.gameId) === norm(parts[3]))) return undefined;
    rows.push({ slot, fullName: parts[1], nickname: parts[2], gameId: parts[3], contact: parts[4] || undefined, role: "player" });
  }
  return rows.length ? rows.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)) : undefined;
}
function parseForm(text: string, paid: boolean, clan: boolean, maxPlayers: number, maxSubs: number): RegistrationDraft | string {
  const lines = text.replace(/\r/g, "").split("\n"); const fields: Record<string, string> = {}; const players: string[] = []; const subs: string[] = [];
  let section: "players" | "subs" = "players";
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (/^игроки\s*:?$/i.test(line)) { section = "players"; continue; }
    if (/^запасные\s*:?$/i.test(line)) { section = "subs"; continue; }
    const colon = line.indexOf(":");
    if (colon > 0 && !line.includes("|")) { fields[norm(line.slice(0, colon).replace("*", ""))] = line.slice(colon + 1).trim(); continue; }
    (section === "players" ? players : subs).push(line);
  }
  const teamName = fields["команда"] ?? ""; const captainName = fields["капитан"] ?? "";
  const parsedPlayers = parseRows(players, maxPlayers); const parsedSubs = parseRows(subs, maxSubs);
  if (!teamName || !captainName || !parsedPlayers) return "Заполните название команды, ФИО капитана и хотя бы одного игрока в указанном формате.";
  if (paid && !fields["подтверждение оплаты"]) return "Для платной регистрации укажите подтверждение оплаты.";
  if (clan && fields["команд клана"] && (!/^\d+$/.test(fields["команд клана"]) || Number(fields["команд клана"]) < 1)) return "Укажите количество команд клана целым числом.";
  if (subs.some(Boolean) && !parsedSubs) return "Проверьте строки запасных: номер | ФИО | ник | игровой ID | контакт.";
  return { teamName, captainName, captainUsername: fields["username капитана"] || undefined, captainPhone: fields["контакт"] || "", captainGameId: fields["id капитана"] || undefined, clanName: clan ? fields["клан"] || undefined : undefined, clanTeams: clan && fields["команд клана"] ? Number(fields["команд клана"]) : undefined, paymentToken: fields["подтверждение оплаты"] || undefined, players: parsedPlayers, substitutes: parsedSubs ?? [], paidFlag: paid };
}
function preview(draft: RegistrationDraft) {
  const list = (title: string, rows: Player[]) => rows.length
    ? "\n" + title + "\n" + rows.map(p => [p.slot + ". " + (p.fullName ?? ""), p.nickname, p.gameId, p.contact].filter(Boolean).join(" | ")).join("\n")
    : "";
  return "Проверьте заявку:\nКоманда: " + draft.teamName + "\nКапитан: " + draft.captainName
    + (draft.clanName ? "\nКлан: " + draft.clanName : "")
    + (draft.captainPhone ? "\nКонтакт: " + draft.captainPhone : "")
    + list("Игроки:", draft.players) + list("Запасные:", draft.substitutes);
}
function csv(draft: RegistrationDraft) { return csvHeaders.split("\n")[0] + "\n" + [...draft.players, ...draft.substitutes].map(p => [p.slot, p.fullName, p.nickname, p.gameId, p.contact ?? ""].map(v => "\"" + String(v).replaceAll("\"", "\"\"") + "\"").join(",")).join("\n"); }
async function begin(ctx: Ctx, paidFlag: boolean) {
  const data = await readTournament(ctx); if (!data) return ctx.reply("Данные регистрации пока недоступны. Попробуйте позже.", { reply_markup: back() });
  clear(ctx); ctx.session.paidFlag = paidFlag;
  await ctx.reply(form(data.paid.enabled || paidFlag, data.paid.clanMultiTeam === true, data.paid.maxPlayers ?? 6, data.paid.maxSubstitutes ?? 2), { reply_markup: controls() });
}
export async function beginRegistration(ctx: Ctx, paidFlag = false) { await begin(ctx, paidFlag); }

composer.callbackQuery("register:start", async ctx => { await ctx.answerCallbackQuery(); const data = await readTournament(ctx); if (!data) return ctx.reply("Данные регистрации пока недоступны. Попробуйте позже.", { reply_markup: back() }); if (data.teams.some(t => t.captainTelegramId === ctx.from?.id && t.status !== "rejected")) return ctx.reply("У вас уже есть регистрация команды. Для изменений обратитесь к организатору.", { reply_markup: back() }); await begin(ctx, false); });
composer.callbackQuery("register:template", async ctx => { await ctx.answerCallbackQuery(); await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(csvHeaders), "Шаблон-регистрации.csv"), { caption: "CSV-шаблон: заполните строки игроков и вставьте форму сообщением." }); });
composer.callbackQuery("register:form", async ctx => { await ctx.answerCallbackQuery(); ctx.session.step = "registration_form"; await ctx.reply("Отправьте заполненную форму одним сообщением или CSV-файлом.", { reply_markup: { force_reply: true, input_field_placeholder: "Вставьте заполненную форму…" } }); });
composer.callbackQuery("register:edit", async ctx => { await ctx.answerCallbackQuery(); ctx.session.step = "registration_form"; await ctx.reply("Внесите изменения и отправьте форму ещё раз.", { reply_markup: { force_reply: true, input_field_placeholder: "Вставьте заполненную форму…" } }); });
composer.callbackQuery("register:cancel", async ctx => { await ctx.answerCallbackQuery(); clear(ctx); await ctx.reply("Регистрация отменена.", { reply_markup: back() }); });
composer.callbackQuery("register:confirm", async ctx => {
  await ctx.answerCallbackQuery(); const draft = ctx.session.registrationDraft; if (!draft || !ctx.from) return;
  const data = await readTournament(ctx); if (!data) return ctx.reply("Данные регистрации пока недоступны. Попробуйте позже.");
  const team: Team = { id: nextId(data, "t"), teamName: draft.teamName, captainTelegramId: ctx.from.id, captainPhone: draft.captainPhone, players: draft.players, substitutes: draft.substitutes, paidFlag: draft.paidFlag, clanName: draft.clanName, clanTeams: draft.clanTeams, captainName: draft.captainName, captainUsername: draft.captainUsername, captainGameId: draft.captainGameId, paymentToken: draft.paymentToken, status: "active", wins: 0, losses: 0, matchLinks: [] };
  const ids = allGameIds(team); const incumbent = data.teams.find(other => other.status === "active" && allGameIds(other).some(id => ids.includes(id)));
  if (incumbent) { team.status = "conflict"; data.teams.push(team); data.conflicts.push({ id: nextId(data, "c"), challengerId: team.id, incumbentId: incumbent.id, gameIds: allGameIds(incumbent).filter(id => ids.includes(id)), resolved: false }); }
  else data.teams.push(team);
  if (!await writeTournament(ctx, data)) return ctx.reply("Не удалось сохранить регистрацию. Попробуйте позже.");
  clear(ctx); const owner = adminChatId(ctx as never); if (owner) try { await ctx.api.sendMessage(owner, (incumbent ? "Конфликт игрового ID" : "Новая регистрация") + ":\n" + preview(draft)); await ctx.api.sendDocument(owner, new InputFile(new TextEncoder().encode(csv(draft)), "Заявка-команды.csv")); } catch { /* Admin delivery is best effort. */ }
  await ctx.reply(incumbent ? "Обнаружен конфликт игрового ID с командой «" + incumbent.teamName + "». Заявка отправлена на проверку." : "Команда зарегистрирована и активна.", { reply_markup: back() });
});
composer.on("message:text", async (ctx, next) => { if (ctx.session.step !== "registration_form") return next(); const data = await readTournament(ctx); if (!data) return ctx.reply("Данные регистрации пока недоступны. Попробуйте позже."); const parsed = parseForm(ctx.message.text, data.paid.enabled || ctx.session.paidFlag === true, data.paid.clanMultiTeam === true, data.paid.maxPlayers ?? 6, data.paid.maxSubstitutes ?? 2); if (typeof parsed === "string") return ctx.reply(parsed, { reply_markup: controls() }); const submittedIds = parsed.players.concat(parsed.substitutes).map(p => norm(p.gameId)).concat(parsed.captainGameId ? [norm(parsed.captainGameId)] : []); const used = new Set(submittedIds); if (used.size !== submittedIds.length) return ctx.reply("В форме повторяется игровой ID. Исправьте его перед отправкой.", { reply_markup: controls() }); const conflicts = data.teams.filter(t => t.status === "active" && allGameIds(t).some(id => used.has(id))); ctx.session.registrationDraft = parsed; ctx.session.step = "registration_preview"; const conflictNote = conflicts.length ? "\n\nЕсть конфликт ID с: " + conflicts.map(t => t.teamName).join(", ") + ". После подтверждения организатор выберет активную команду." : ""; await ctx.reply(preview(parsed) + conflictNote, { reply_markup: inlineKeyboard([[inlineButton("Подтвердить заявку", "register:confirm")], [inlineButton("Изменить", "register:edit")], [inlineButton("Отмена", "register:cancel")]]) }); });
export default composer;
