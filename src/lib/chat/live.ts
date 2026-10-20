import { prisma } from '@/lib/prisma';

/** Сервер опрашивает базу раз в 2 секунды (разделы 3.7 и 5.3 ТЗ): без Redis и очередей. */
export const POLL_INTERVAL_MS = 2_000;
/** Поток живёт ограниченное время, дальше браузер переподключается сам. */
export const STREAM_LIFETIME_MS = 5 * 60_000;

/**
 * Переписки компании, в которых что-то изменилось после `since`: новое сообщение
 * (любой стороны, в том числе с другого устройства) или собеседник прочитал наше.
 * Правило 4: только чаты, где компания — одна из сторон.
 */
export async function chatChangesSince(companyId: string, since: Date): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: {
      chat: { OR: [{ storeId: companyId }, { supplierId: companyId }] },
      OR: [{ createdAt: { gt: since } }, { authorCompanyId: companyId, readAt: { gt: since } }],
    },
    select: { chatId: true },
    distinct: ['chatId'],
    take: 50,
  });
  return rows.map((row) => row.chatId);
}

/** Сотрудник всё ещё в компании: заблокированный теряет поток на следующем опросе. */
async function stillMember(membershipId: string) {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { status: true },
  });
  return membership?.status === 'ACTIVE';
}

export type ChatStreamOptions = {
  companyId: string;
  membershipId: string;
  signal?: AbortSignal;
  intervalMs?: number;
  lifetimeMs?: number;
  now?: () => Date;
};

/**
 * Server-Sent Events чата: раз в интервал проверяет изменения и шлёт событие `chats`
 * со списком переписок, которые клиенту стоит перечитать. Пустой опрос шлёт комментарий,
 * чтобы прокси не закрывали соединение.
 */
export function chatEventStream(options: ChatStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const lifetimeMs = options.lifetimeMs ?? STREAM_LIFETIME_MS;
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = now();
      let since = startedAt;

      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // Поток уже закрыт клиентом.
        }
      };
      options.signal?.addEventListener('abort', close);

      // Браузер переподключается через 3 секунды, если поток оборвался.
      controller.enqueue(encoder.encode('retry: 3000\nevent: ready\ndata: {}\n\n'));

      const tick = async () => {
        if (closed) return;
        try {
          if (!(await stillMember(options.membershipId))) return close();
          const checkedAt = now();
          const chatIds = await chatChangesSince(options.companyId, since);
          since = checkedAt;
          if (closed) return;
          controller.enqueue(
            encoder.encode(
              chatIds.length > 0
                ? `event: chats\ndata: ${JSON.stringify({ chatIds })}\n\n`
                : ': ping\n\n',
            ),
          );
        } catch {
          return close();
        }
        if (now().getTime() - startedAt.getTime() >= lifetimeMs) return close();
        timer = setTimeout(() => void tick(), intervalMs);
      };
      timer = setTimeout(() => void tick(), intervalMs);
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
    },
  });
}
