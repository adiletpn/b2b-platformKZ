# Этап 3: состояние работы (ветка feature/stage3)

Ветка начата от `claude/core-flow-real-companies-vybdfs`. Задание — сообщение заказчика
«этап 3 без внешних сервисов и отложенные функции этапов 1–2».

## Сделано (коммит «Блок A»)

- Миграция `20261020130000_s3a_voice_pieces_banners` (накатить на Railway: `npm run db:deploy`).
- A1 голосовые: `detectAudioType` (webm/ogg/mp4) в `src/lib/files/attachments.ts`, вид вложения
  `VOICE`, `Attachment.durationMs`, `sendVoice` в `src/lib/chat/extras.ts`, маршрут
  `/api/chats/[id]/voice`, запись MediaRecorder и плеер в `chat-screen.tsx`. Лимит 2 минуты.
- A2 SSE: `src/lib/chat/live.ts`, маршрут `/api/chats/stream` (опрос базы раз в 2 с, только чаты
  своей компании, проверка блокировки сотрудника), клиент переподключается, без потока — опрос раз в 5 с.
- A3 дубли и бренды: `src/lib/admin/products.ts`, `/api/admin/products`, `/api/admin/brands`,
  панели в `admin/catalog-panel.tsx` (Суперадмин и Контент-менеджер), журнал `product_merged`.
- A4 поштучно: `RetailPrice.piecesPerPack/piecePrice`, `ReceiptItem.pieces`, `setPieceSale`
  в `src/lib/stock/pricing.ts`, продажа `byPiece` в `src/lib/pos/sale.ts`, округление доли —
  настройка `piece_sale_rounding` (TODO(open-question)). Маркированный — отказ.
- A5 баннеры: модель `Banner`, `src/lib/admin/banners.ts`, `/api/admin/banners`, панель админки,
  `CabinetBanners` на главной кабинета (закрытие в localStorage).

## Сделано (коммит «B6 лояльность»)

- Миграция `20261020140000_s3b_loyalty`: `LoyaltyCustomer`, `LoyaltyMovement`, поля чека
  `loyaltyCustomerId`, `bonusRedeemed`, `bonusEarned`.
- `src/lib/pos/loyalty.ts`: настройки `loyalty_earn_percent`=5 и `loyalty_max_redeem_share`=50
  (TODO(open-question)), начисление с оплаченного деньгами вниз до копейки, списание условным
  обновлением в транзакции чека, откат при возврате (баланс может уйти в минус — TODO).
- `Receipt.total` — полная сумма чека, к оплате деньгами `total − bonusRedeemed`; в Z-отчёте
  строка `BONUS` и `bonusEarned`; фискальный мок получает оплату деньгами и бонусами.
- Касса: блок «Бонусы покупателя», маршрут `/api/pos/loyalty?phone=`, печатный чек.
- Касса: плитка «Поштучно» (`pos-tile-piece`), строка чека по ключу `key`, штуки в печатном чеке.
- Тесты: `tests/integration/loyalty-pieces.test.ts`, e2e `tests/e2e/f2-loyalty.spec.ts`.

## Сделано (коммит «B7 аналитика»)

- `src/lib/analytics/analytics.ts`: `storeAnalytics` (продажи и прибыль по дням и категориям,
  ABC с порогами `analytics_abc_thresholds`=80,95, оборачиваемость, залежавшийся по
  `analytics_stale_days`=30, рекомендации из `getRecommendations`) и `supplierAnalytics`
  (оборот по магазинам и товарам, доля выполненных, топ-5). Статусы оборота — TODO(open-question).
- Экран `/analytics` (пункт меню «Аналитика»), график `src/components/bar-chart.tsx` (SVG),
  Excel `/api/analytics/xlsx`. Права: магазин — PURCHASE_PRICES VIEW, поставщик — SWIPE_ORDERS VIEW.
- Тесты: `tests/integration/analytics.test.ts`, шаг в `tests/e2e/f2-loyalty.spec.ts`.

## Сделано (коммит «B8 торговые представители»)

- Миграция `20261020150000_s3c_sales_reps`: раздел прав `SALES_REPS`, `SalesRepStore`
  (один представитель на магазин у поставщика), `SalesRepVisit`. Модель D1 не тронута:
  `Membership.role` для роли вне enum пишется `SALES_MANAGER`, права берутся из `roleId`.
- Сид: системная роль `SALES_REP` (SALES_REPS: VIEW, CREATE), у Владельца — весь раздел.
- `src/lib/reps/reps.ts`, `/api/reps`, экран `/reps` (пункт меню у поставщика).
- Экраны `/orders` и `/orders/[id]` теперь требуют SWIPE_ORDERS VIEW (кассир, водитель и
  представитель туда не попадают; раньше страница списка права не проверяла).
- Заявка от имени магазина — не сделана, TODO(open-question).
- Тесты: `tests/integration/sales-reps.test.ts`, e2e `tests/e2e/f3-sales-rep.spec.ts`.

## Как гонять e2e в этом контейнере

Node 22.22 падает при загрузке спек («module not been linked»). Рабочий способ: собрать
`npm run build`, поднять `DATABASE_URL=$TEST_DATABASE_URL npm run start -- --port 3100`,
подготовить базу любым `npx vitest run tests/unit/barcode.test.ts` и запускать
`NODE_OPTIONS=--no-experimental-require-module npx playwright test -c pw.local.config.ts`
(локальный конфиг без webServer и globalSetup, в git не попадает).

## Не доделано

- Интеграционные тесты дублей и баннеров, e2e объединения дублей.
- B9 маршруты водителей — код есть, не проверен тестами (коммит «B9 черновик»): миграция
  `20261020160000_s3d_delivery_routes`, `src/lib/deliveries/routes.ts`, `/api/deliveries/routes`,
  PDF `/api/deliveries/routes/[id]/pdf`, панель `deliveries/routes-panel.tsx`. Нужны
  интеграционный тест и e2e рейса (375 и 1280 px), прогон e9-deliveries.
  План по каждому пункту был такой:
  - 6: `LoyaltyCustomer(companyId, phone, balance)`, `LoyaltyMovement`, поля чека
    `bonusRedeemed/bonusEarned/loyaltyCustomerId`; «к оплате» = total − бонусы, в Z-отчёте строка
    BONUS; настройки `loyalty_earn_percent`=5, `loyalty_max_redeem_share`=50; возврат откатывает оба.
  - 7: экран `/analytics`, ABC (настройка 80/95), залежавшийся (30 дней), SVG-графики, Excel,
    рекомендации из `getRecommendations`.
  - 8: раздел прав `SALES_REPS`, системная роль `SALES_REP`, таблицы закрепления и визитов;
    в `acceptPendingInvitations` код роли вне enum `MembershipRole` нужно сводить к базовому.
  - 9: `DeliveryRoute` + `DeliveryRouteStop`, сборка рейса на `/deliveries`, PDF через `renderPdf`.
- Документация (CLAUDE.md, REMAINING.md, TZ-demo.md 8, DEMO.md) и сид демо-данных.
