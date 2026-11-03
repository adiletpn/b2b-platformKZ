import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { POST as requestCode } from '@/app/api/auth/request-code/route';
import { verifyLoginCode } from '@/lib/auth/otp';
import { resetFirebaseCertCache, verifyFirebaseIdToken } from '@/lib/sms/firebase';

const prisma = createTestPrisma();
const PHONE = '+77050000001';
const PROJECT = 'b2b-test';

function call(phone = PHONE) {
  return requestCode(
    new Request('http://localhost/api/auth/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, locale: 'ru' }),
    }),
  );
}

/** Ключ, которым «Google» подписывает токены в тестах. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KID = 'test-kid';

function makeToken(
  overrides: Record<string, unknown> = {},
  header: Record<string, unknown> = { alg: 'RS256', kid: KID },
) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: 'uid-1',
    iat: now - 10,
    auth_time: now - 10,
    exp: now + 3600,
    phone_number: PHONE,
    ...overrides,
  };
  const head = Buffer.from(JSON.stringify(header)).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${signature.toString('base64url')}`;
}

/** Ответ Google с открытыми ключами: так его отдаёт googleapis.com. */
function certsReply() {
  return new Response(JSON.stringify({ [KID]: PUBLIC_PEM }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
}

function stubFirebase() {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-api-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', PROJECT);
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.otpCode.deleteMany();
  resetFirebaseCertCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SMS через Firebase', () => {
  it('without_firebase_mock_returns_code_for_demo', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await call();
    const body = (await response.json()) as { code?: string; via?: string };

    expect(response.status).toBe(200);
    expect(body.via).toBe('mock');
    expect(body.code).toMatch(/^\d{6}$/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await verifyLoginCode(PHONE, { code: body.code! })).ok).toBe(true);
  });

  it('with_firebase_server_keeps_no_code_and_client_sends_it', async () => {
    stubFirebase();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await call();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.via).toBe('firebase');
    expect(body).not.toHaveProperty('code');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.otpCode.count({ where: { phone: PHONE } })).toBe(0);
  });

  it('with_firebase_valid_token_signs_in', async () => {
    stubFirebase();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(certsReply()));

    const result = await verifyLoginCode(PHONE, { idToken: makeToken() });

    expect(result.ok).toBe(true);
  });

  it('with_firebase_plain_code_is_refused', async () => {
    stubFirebase();
    await prisma.otpCode.create({
      data: { phone: PHONE, code: '123456', expiresAt: new Date(Date.now() + 60_000) },
    });

    expect(await verifyLoginCode(PHONE, { code: '123456' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('token_for_another_phone_is_refused', async () => {
    stubFirebase();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(certsReply()));

    const token = makeToken({ phone_number: '+77059999999' });

    expect((await verifyLoginCode(PHONE, { idToken: token })).ok).toBe(false);
  });

  it('token_checks_signature_expiry_and_project', async () => {
    const fetchCerts = async () => ({ [KID]: PUBLIC_PEM });
    const check = (token: string) =>
      verifyFirebaseIdToken(token, { projectId: PROJECT, fetchCerts });

    expect(await check(makeToken())).toEqual({ ok: true, phone: PHONE, uid: 'uid-1' });

    const forged = makeToken().split('.');
    forged[1] = Buffer.from(JSON.stringify({ phone_number: '+77050000002' })).toString(
      'base64url',
    );
    expect(await check(forged.join('.'))).toEqual({ ok: false, reason: 'signature' });

    expect(await check(makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 }))).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await check(makeToken({ aud: 'other-project' }))).toEqual({
      ok: false,
      reason: 'project',
    });
    expect(await check(makeToken({ phone_number: undefined }))).toEqual({
      ok: false,
      reason: 'no_phone',
    });
    expect(await check(makeToken({}, { alg: 'HS256', kid: KID }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(await check(makeToken({}, { alg: 'RS256', kid: 'unknown' }))).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('google_certs_are_cached_between_checks', async () => {
    stubFirebase();
    const fetchMock = vi.fn().mockImplementation(async () => certsReply());
    vi.stubGlobal('fetch', fetchMock);

    await verifyLoginCode(PHONE, { idToken: makeToken() });
    await verifyLoginCode(PHONE, { idToken: makeToken() });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
