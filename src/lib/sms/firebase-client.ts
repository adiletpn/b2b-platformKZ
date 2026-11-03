import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth';

/**
 * Браузерная часть входа по SMS через Firebase. Грузится динамически и только когда
 * сервер ответил via: 'firebase', поэтому без ключей Firebase SDK в бандл страницы не попадает.
 * Переменные NEXT_PUBLIC_* подставляются при сборке: на Railway их задают до build.
 */
function firebaseAuth(locale: string) {
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain:
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
        `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  const auth = getAuth(app);
  // Текст SMS от Firebase — на языке интерфейса.
  auth.languageCode = locale;
  return auth;
}

export type FirebaseError =
  'invalid' | 'expired' | 'too_many_requests' | 'invalid_phone' | 'sms_failed';

function mapError(error: unknown): FirebaseError {
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code === 'auth/invalid-verification-code' || code === 'auth/missing-verification-code') {
    return 'invalid';
  }
  if (code === 'auth/code-expired' || code === 'auth/session-expired') return 'expired';
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
    return 'too_many_requests';
  }
  if (code === 'auth/invalid-phone-number' || code === 'auth/missing-phone-number') {
    return 'invalid_phone';
  }
  return 'sms_failed';
}

/** Отправка кода: невидимая reCAPTCHA, затем SMS от Firebase. */
export async function sendFirebaseCode(
  phone: string,
  locale: string,
): Promise<{ ok: true; confirmation: ConfirmationResult } | { ok: false; error: FirebaseError }> {
  const auth = firebaseAuth(locale);
  // Свой контейнер на каждую отправку: повторно отрисованная reCAPTCHA падает.
  const container = document.createElement('div');
  container.hidden = true;
  document.body.appendChild(container);
  const verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
  try {
    const confirmation = await signInWithPhoneNumber(auth, phone, verifier);
    return { ok: true, confirmation };
  } catch (error) {
    return { ok: false, error: mapError(error) };
  } finally {
    verifier.clear();
    container.remove();
  }
}

/** Проверка кода у Firebase: на выходе ID-токен для нашего сервера. */
export async function confirmFirebaseCode(
  confirmation: ConfirmationResult,
  code: string,
  locale: string,
): Promise<{ ok: true; idToken: string } | { ok: false; error: FirebaseError }> {
  try {
    const credential = await confirmation.confirm(code.trim());
    const idToken = await credential.user.getIdToken();
    // Сессию держит наш сервер, вход в Firebase в браузере больше не нужен.
    await signOut(firebaseAuth(locale));
    return { ok: true, idToken };
  } catch (error) {
    return { ok: false, error: mapError(error) };
  }
}
