# Esports Team Registrar — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot for esports tournament organizers to collect team registrations, manage game ID conflicts, and display live match results. Captains register teams with player details; admins resolve conflicts and add match links; paid registration is owner-configured with optional clan multi-team support.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Tournament organizers
- Esports team captains
- Event admins

## Success criteria

- Captains can register teams with required player details
- Admins receive and resolve game ID conflicts
- Public can view teams and match results in real-time
- Paid registration enforces payment confirmation when enabled

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with registration options
- **Register Team** (button, actor: user, callback: register:start) — Initiate team registration questionnaire for captains
- **View Teams & Table** (button, actor: user, callback: view:teams) — Show public list of registered teams and match results
- **Open Paid Registration** (button, actor: user, callback: paid:register) — Access paid registration view (if enabled by owner)

## Flows

### Team Registration
_Trigger:_ register:start

1. Display registration questionnaire
2. Validate game ID uniqueness
3. Flag conflicts and notify admins
4. Confirm team creation

_Data touched:_ Team, Player

### Conflict Resolution
_Trigger:_ admin:conflict

1. Admin receives conflict notification
2. Admin selects winning team via 1/2 reply
3. Mark resolved team as active

_Data touched:_ Team, Player

### Match Table Update
_Trigger:_ admin:add_match

1. Admin adds match result
2. Update team win/loss records
3. Refresh public match table

_Data touched:_ MatchTable

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Telegram chat ID for admin notifications
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Team** _(retention: persistent)_ — Registered esports team with captain and player details
  - fields: team_name, captain_telegram_id, captain_phone, players, substitutes, paid_flag
- **Player** _(retention: persistent)_ — Individual player with game ID and role
  - fields: game_id, in_game_nickname, role
- **MatchTable** _(retention: persistent)_ — Live match results and standings
  - fields: team_list, wins, losses, match_links
- **PaidSettings** _(retention: persistent)_ — Paid registration configuration
  - fields: price, payment_link, enabled

## Integrations

- **Telegram** (required) — Bot API messaging and inline buttons
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Enable/disable paid registration
- Set payment price and confirmation link
- Configure admin notification chat ID

## Notifications

- Admins receive new registration alerts
- Conflict notifications with team summaries
- Admins can insert match links for teams

## Permissions & privacy

- Only team captains can register teams
- Game IDs are checked for uniqueness across active teams
- Paid registration requires confirmation via owner-configured method

## Edge cases

- Duplicate game ID conflicts during registration
- Users attempting to register multiple teams in free view
- Admins not responding to conflict notifications

## Required tests

- End-to-end team registration with conflict resolution
- Admin conflict resolution workflow
- Public match table updates after results

## Assumptions

- Registration form includes team name, captain contact, and player details
- Admin conflict resolution uses simple 1/2 reply format
- Paid registration confirmation handled via owner-configured link
