import { createPublicKey, verify } from 'node:crypto';

/**
 * Вход по SMS через Firebase Phone Auth. Код отправляет и проверяет сам Firebase в браузере,
 * сервер получает от клиента ID-токен и проверяет его здесь: подпись ключами Google,
 * срок, проект и номер телефона в токене. Сервисный аккаунт и firebase-admin не нужны —
 * открытые ключи Google публикует сам (документация Firebase, «Verify ID tokens using
 * a third-party JWT library»).
 *
 * Включается переменными NEXT_PUBLIC_FIREBASE_* (веб-конфиг Firebase публичный по устройству).
 * Без них работает мок: код показывается в интерфейсе (CLAUDE.md, «Моки»).
 */
const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FETCH_TIMEOUT_MS = 10_000;
/** Запас на расхождение часов сервера и Google. */
const CLOCK_SKEW_SECONDS = 60;

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

/** Веб-конфиг Firebase или null, если SMS через Firebase не подключены. */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  };
}

export function isFirebaseSmsLive(): boolean {
  return firebaseWebConfig() !== null;
}

type Certs = Record<string, string>;
let certCache: { certs: Certs; expiresAt: number } | null = null;

async function fetchGoogleCerts(): Promise<Certs> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;
  const response = await fetch(CERTS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`google certs http ${response.status}`);
  const certs = (await response.json()) as Certs;
  // Google указывает срок жизни ключей в Cache-Control: max-age.
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1]);
  certCache = { certs, expiresAt: Date.now() + (Number.isFinite(maxAge) ? maxAge : 3600) * 1000 };
  return certs;
}

function decodePart<T>(part: string): T | null {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export type TokenCheck =
  | { ok: true; phone: string; uid: string }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'project' | 'no_phone' | 'certs' };

type Header = { alg?: string; kid?: string };
type Payload = {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  phone_number?: string;
};

/** Проверка ID-токена Firebase. fetchCerts и now подменяются в тестах. */
export async function verifyFirebaseIdToken(
  token: string,
  options: { projectId: string; now?: number; fetchCerts?: () => Promise<Certs> },
): Promise<TokenCheck> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodePart<Header>(headerPart);
  const payload = decodePart<Payload>(payloadPart);
  if (!header || !payload || header.alg !== 'RS256' || !header.kid) {
    return { ok: false, reason: 'malformed' };
  }

  let certs: Certs;
  try {
    certs = await (options.fetchCerts ?? fetchGoogleCerts)();
  } catch {
    return { ok: false, reason: 'certs' };
  }
  const pem = certs[header.kid];
  if (!pem) return { ok: false, reason: 'signature' };

  let valid = false;
  try {
    valid = verify(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      createPublicKey(pem),
      Buffer.from(signaturePart, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature' };

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (
    typeof payload.exp !== 'number' ||
    payload.exp + CLOCK_SKEW_SECONDS < now ||
    typeof payload.iat !== 'number' ||
    payload.iat - CLOCK_SKEW_SECONDS > now ||
    (typeof payload.auth_time === 'number' && payload.auth_time - CLOCK_SKEW_SECONDS > now)
  ) {
    return { ok: false, reason: 'expired' };
  }
  if (
    payload.aud !== options.projectId ||
    payload.iss !== `https://securetoken.google.com/${options.projectId}` ||
    !payload.sub
  ) {
    return { ok: false, reason: 'project' };
  }
  if (!payload.phone_number) return { ok: false, reason: 'no_phone' };
  return { ok: true, phone: payload.phone_number, uid: payload.sub };
}

/** Токен подтверждает именно этот номер: иначе код с чужого телефона открыл бы вход. */
export async function verifyFirebasePhone(idToken: string, phone: string): Promise<boolean> {
  const config = firebaseWebConfig();
  if (!config) return false;
  const result = await verifyFirebaseIdToken(idToken, { projectId: config.projectId });
  return result.ok && result.phone === phone;
}

/** Для тестов: сброс кэша ключей. */
export function resetFirebaseCertCache() {
  certCache = null;
}
