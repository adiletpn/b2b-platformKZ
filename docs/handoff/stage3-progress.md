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

## Не доделано

- Касса: кнопка/плитка «поштучно» в `pos-screen.tsx` (сервер готов: строка `byPiece: true`,
  `quantity` = число штук), вывод штук в печатном чеке `pos/receipt/[id]/page.tsx`.
- Интеграционные тесты блока A и e2e объединения дублей.
- Блок B целиком: 6 лояльность, 7 аналитика, 8 торговые представители, 9 маршруты водителей.
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
