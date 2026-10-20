import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { POST as requestCode } from '@/app/api/auth/request-code/route';
import { verifyLoginCode } from '@/lib/auth/otp';

const prisma = createTestPrisma();
const PHONE = '+77050000001';

function call(phone = PHONE) {
  return requestCode(
    new Request('http://localhost/api/auth/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, locale: 'ru' }),
    }),
  );
}

/** Ответ Mobizon: code 0 — сообщение принято. */
function mobizonReply(code: number) {
  return new Response(JSON.stringify({ code, data: { messageId: '42' }, message: '' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.otpCode.deleteMany();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SMS-провайдер', () => {
  it('without_key_mock_returns_code_for_demo', async () => {
    vi.stubEnv('SMS_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await call();
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(200);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with_key_code_goes_to_mobizon_and_not_to_response', async () => {
    vi.stubEnv('SMS_API_KEY', 'test-key');
    vi.stubEnv('SMS_SENDER', 'B2BKZ');
    const fetchMock = vi.fn().mockResolvedValue(mobizonReply(0));
    vi.stubGlobal('fetch', fetchMock);

    const response = await call();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('code');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.mobizon.kz/service/message/sendSmsMessage');
    expect(url).toContain('apiKey=test-key');
    const form = init.body as URLSearchParams;
    expect(form.get('recipient')).toBe('77050000001');
    expect(form.get('from')).toBe('B2BKZ');

    // Код из SMS — тот, что лежит в базе: по нему пользователь и входит.
    const code = /\d{6}/.exec(form.get('text') ?? '')![0];
    expect((await verifyLoginCode(PHONE, code)).ok).toBe(true);
  });

  it('provider_error_gives_clear_status_and_masked_log', async () => {
    vi.stubEnv('SMS_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mobizonReply(1)));
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => logged.push(args.join(' ')));
    vi.spyOn(console, 'info').mockImplementation((...args) => logged.push(args.join(' ')));

    const response = await call();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'sms_failed' });
    // Правило 11: номер в логе только маской.
    expect(logged.join('\n')).not.toContain('7050000001');
    expect(logged.join('\n')).toContain('*** ***');
    expect(await prisma.otpCode.count({ where: { phone: PHONE } })).toBe(0);
  });

  it('with_key_repeat_request_within_minute_is_throttled', async () => {
    vi.stubEnv('SMS_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(mobizonReply(0));
    vi.stubGlobal('fetch', fetchMock);

    expect((await call()).status).toBe(200);
    const second = await call();

    expect(second.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
