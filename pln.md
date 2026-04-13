Here is Claude's plan:  
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
Plan: File-Based Persistence + SMS Forcing for TelegramService

Context

n8n оркестрирует 3-шаговый auth flow через несколько HTTP-запросов. Между шагами процесс NestJS может перезапуститься (Railway crash, health check restart), что стирает оба in-memory Map
(authStates и clients). Это ломает авторизацию на Step 2. Дополнительно: нужно доставлять код через SMS, а не через Telegram-приложение.

Единственный файл для изменений: src/telegram/telegram.service.ts

---

Изменения

1.  Новые импорты (вверху файла)

import _ as fs from 'fs';
import _ as path from 'path';

2.  Новые поля класса (после config)

private readonly dataDir = path.join(process.cwd(), 'data');
private readonly authStatesFile = path.join(process.cwd(), 'data', 'auth-states.json');
private readonly sessionsFile = path.join(process.cwd(), 'data', 'sessions.json');

3.  constructor() — первая строка тела

this.ensureDataDir();

4.  TTL cleanup (в setInterval) — добавить строку

this.authStates.delete(phone);
this.deleteAuthState(phone); // ← добавить

5.  authenticate() — Step 1: существующая очистка

this.authStates.delete(phoneNumber);
this.deleteAuthState(phoneNumber); // ← добавить

6.  authenticate() — Step 1: force SMS (одна строка)

// До:
client.sendCode({ apiId: this.config.apiId, apiHash: this.config.apiHash }, phoneNumber)
// После:
client.sendCode({ apiId: this.config.apiId, apiHash: this.config.apiHash }, phoneNumber, true)

7.  authenticate() — Step 1: сохранение после authStates.set()

this.authStates.set(phoneNumber, { client, phoneCodeHash: result.phoneCodeHash, phoneNumber, createdAt: Date.now() });
this.saveAuthState(phoneNumber, result.phoneCodeHash, Date.now()); // ← добавить

8.  authenticate() — Step 2: восстановление authState из файла

Заменить текущую проверку if (!authState):

let authState = this.authStates.get(phoneNumber);

if (!authState) {
const persisted = this.loadAuthStates();
const saved = persisted.get(phoneNumber);
if (saved) {
const restoredClient = this.createClient();
await restoredClient.connect();
authState = { client: restoredClient, phoneCodeHash: saved.phoneCodeHash, phoneNumber, createdAt: saved.createdAt };
this.authStates.set(phoneNumber, authState);
console.log(`[authenticate] Restored authState from file for ${phoneNumber}`);
}
}

if (!authState) {
throw new Error('Please request code first by sending phoneNumber without code');
}

9.  authenticate() — Step 2 success: сохранение сессии

this.clients.set(sessionString, authState.client);
this.authStates.delete(phoneNumber);
this.saveSession(sessionString); // ← добавить
this.deleteAuthState(phoneNumber); // ← добавить

10. authenticate() — Step 3 (2FA) success: то же самое

this.clients.set(sessionString, authState.client);
this.authStates.delete(phoneNumber);
this.saveSession(sessionString); // ← добавить
this.deleteAuthState(phoneNumber); // ← добавить

11. authenticate() — outer catch: очистка файла

this.authStates.delete(phoneNumber);
this.deleteAuthState(phoneNumber); // ← добавить

12. getClient() — сделать async + восстановление из файла

Изменить сигнатуру: private async getClient(sessionString: string): Promise<TelegramClient>

Заменить блок if (!this.clients.has(cleanSession)):

if (!this.clients.has(cleanSession)) {
const persisted = this.loadSessions();
if (persisted.has(cleanSession)) {
console.log('[getClient] Session found in file, restoring client...');
const restoredClient = this.createClient(cleanSession);
await restoredClient.connect();
this.clients.set(cleanSession, restoredClient);
console.log('[getClient] ✅ Client restored from file');
return restoredClient;
}
console.error('[getClient] ❌ Client not found in cache or file!');
throw new BadRequestException('Session not found. Please authenticate first using POST /telegram/auth');
}

13. disconnect() — удалять сессию из файла

this.clients.delete(sessionString);
this.deleteSession(sessionString); // ← добавить

---

Новые приватные методы (добавить в конец класса)

private ensureDataDir(): void {
try { fs.mkdirSync(this.dataDir, { recursive: true }); }
catch (error) { console.error('[TelegramService] Failed to create data directory:', error.message); }
}

private loadAuthStates(): Map<string, { phoneCodeHash: string; createdAt: number }> {
try {
if (!fs.existsSync(this.authStatesFile)) return new Map();
const parsed = JSON.parse(fs.readFileSync(this.authStatesFile, 'utf-8'));
return new Map(Object.entries(parsed));
} catch { return new Map(); }
}

private saveAuthState(phoneNumber: string, phoneCodeHash: string, createdAt: number): void {
try {
const existing = this.loadAuthStates();
existing.set(phoneNumber, { phoneCodeHash, createdAt });
fs.writeFileSync(this.authStatesFile, JSON.stringify(Object.fromEntries(existing), null, 2));
} catch (error) { console.error('[TelegramService] Failed to save auth state:', error.message); }
}

private deleteAuthState(phoneNumber: string): void {
try {
const existing = this.loadAuthStates();
existing.delete(phoneNumber);
fs.writeFileSync(this.authStatesFile, JSON.stringify(Object.fromEntries(existing), null, 2));
} catch (error) { console.error('[TelegramService] Failed to delete auth state:', error.message); }
}

private loadSessions(): Set<string> {
try {
if (!fs.existsSync(this.sessionsFile)) return new Set();
return new Set(JSON.parse(fs.readFileSync(this.sessionsFile, 'utf-8')) as string[]);
} catch { return new Set(); }
}

private saveSession(sessionString: string): void {
try {
const existing = this.loadSessions();
existing.add(sessionString);
fs.writeFileSync(this.sessionsFile, JSON.stringify(Array.from(existing), null, 2));
} catch (error) { console.error('[TelegramService] Failed to save session:', error.message); }
}

private deleteSession(sessionString: string): void {
try {
const existing = this.loadSessions();
existing.delete(sessionString);
fs.writeFileSync(this.sessionsFile, JSON.stringify(Array.from(existing), null, 2));
} catch (error) { console.error('[TelegramService] Failed to delete session:', error.message); }
}

---

Поведение при ошибках

┌───────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────┐
│ Сценарий │ Поведение │
├───────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┤
│ Директория data/ не создаётся │ Лог + продолжает работу (in-memory достаточно в том же процессе) │
├───────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┤
│ auth-states.json повреждён │ loadAuthStates() → пустой Map, пользователь запрашивает код заново │
├───────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┤
│ sessions.json повреждён │ loadSessions() → пустой Set, getClient() → 400, нужна повторная авторизация │
├───────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┤
│ Railway полный редеплой │ data/ очищается — это ожидаемо; помогает только при crash-restart в том же контейнере │
└───────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────┘

---

Важное замечание по Railway

Файловая система Railway эфемерна при деплое (не при crash-restart). ./data/ выживает после краша/рестарта контейнера, но не после нового деплоя. Это покрывает основной use case (n8n
workflow разбит на несколько шагов, между которыми возможен crash).

---

Проверка

1.  npm run build — убедиться что TypeScript компилируется без ошибок
2.  npm run start:dev — запустить сервис
3.  Вызвать POST /telegram/auth с номером телефона → убедиться что пришёл SMS (не в приложение)
4.  Убедиться что создался data/auth-states.json с phoneCodeHash
5.  Перезапустить сервис (Ctrl+C, снова npm run start:dev)
6.  Вызвать POST /telegram/auth с номером + кодом → должно успешно авторизоваться (восстановление из файла)
7.  Убедиться что создался data/sessions.json с sessionString
8.  Снова перезапустить сервис
9.  Вызвать GET /telegram/channel/:username/posts?sessionString=... → должно работать без авторизации
