import { reportError } from '@/mocks/monitoring';

/**
 * Next отдаёт сюда все необработанные ошибки запросов — это точка подключения
 * мониторинга из НФТ раздела 5.4 ТЗ. В демо события пишутся в лог мок-адаптером.
 */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routeType: string },
) {
  reportError(error, {
    path: request.path,
    method: request.method,
    routeType: context.routeType,
  });
}
