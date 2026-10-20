import type { DocumentType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { formatDate, formatDateTime } from '@/lib/format';

/**
 * QR проверки на печатной форме (раздел 4.4 ТЗ). В QR — ссылка на публичную страницу
 * проверки со случайным кодом документа и номером версии, напечатанной на бумаге.
 */
export function verificationUrl(
  base: string,
  locale: 'ru' | 'kk',
  code: string,
  version: number,
): string {
  return `${base.replace(/\/$/, '')}/${locale}/verify/${code}?v=${version}`;
}

/**
 * Адрес приложения для QR: `APP_URL` на боевом домене, иначе адрес текущего запроса.
 * TODO(open-question): боевой домен платформы не выбран (TZ-demo 8.7).
 */
export function appBaseUrl(request: Request): string {
  return process.env.APP_URL ?? new URL(request.url).origin;
}

/** БИН/ИИН на открытой странице маскируется: у ИП это персональные данные. */
export function maskBin(bin: string): string {
  return bin.length === 12 ? `${bin.slice(0, 4)}••••••${bin.slice(-2)}` : '••••';
}

export type VerificationView = {
  type: DocumentType;
  number: string;
  issuedAt: string;
  issuer: { name: string; bin: string };
  recipient: { name: string; bin: string };
  totalWithVat: string;
  currentVersion: number;
  /** Дата текущей версии: дата документа или последнего исправления. */
  currentVersionDate: string;
  /** На бумаге старая версия: документ с тех пор исправлен. */
  outdated: boolean;
  signatures: { signerName: string; signedAt: string }[];
};

/** Данные для страницы проверки. Код неугадываемый, поэтому страница открыта без входа. */
export async function verifyDocument(
  code: string,
  printedVersion?: number,
): Promise<VerificationView | null> {
  // Посторонний ввод в адресе не должен доходить до базы в виде произвольной строки.
  if (!/^[0-9a-f-]{36}$/i.test(code)) return null;

  const document = await prisma.document.findUnique({
    where: { verificationCode: code },
    include: {
      issuer: { select: { name: true, bin: true } },
      recipient: { select: { name: true, bin: true } },
      signatures: { orderBy: { signedAt: 'asc' } },
    },
  });
  if (!document) return null;

  return {
    type: document.type,
    number: document.number,
    issuedAt: formatDate(document.issuedAt),
    issuer: { name: document.issuer.name, bin: maskBin(document.issuer.bin) },
    recipient: { name: document.recipient.name, bin: maskBin(document.recipient.bin) },
    totalWithVat: document.totalWithVat.toFixed(2),
    currentVersion: document.version,
    currentVersionDate: formatDate(document.correctedAt ?? document.issuedAt),
    outdated: printedVersion !== undefined && printedVersion < document.version,
    signatures: document.signatures
      .filter((signature) => signature.version === document.version)
      .map((signature) => ({
        signerName: signature.signerName,
        signedAt: formatDateTime(signature.signedAt),
      })),
  };
}
