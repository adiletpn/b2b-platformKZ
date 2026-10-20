'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Page, PageHeader } from '@/components/ui/page';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { Badge } from '@/components/ui/badge';
import { OrderProgress } from '@/components/order-progress';
import { DocumentSignatures, type SignatureMark } from '@/components/document-signatures';
import { AttachmentsPanel, type FileRow } from '@/components/attachments-panel';
import { OnlinePaymentPanel, type OnlinePayment } from './online-payment-panel';
import { DocumentVersions, type VersionRow } from './document-versions';

import type { DocumentType, OrderStatus as Status } from '@/generated/prisma/enums';

type Item = {
  id: string;
  nameRu: string;
  nameKk: string;
  unitRu: string;
  unitKk: string;
  quantityOrdered: string;
  quantityConfirmed: string | null;
  priceWithVat: string;
  /** Позиция предложена поставщиком вместо другой (раздел 3.4 ТЗ). */
  substituteForId: string | null;
};

type SubstituteOffer = { id: string; name: string; priceWithVat: string };

type DocumentRow = {
  id: string;
  type: DocumentType;
  number: string;
  totalWithVat: string;
  signatures: SignatureMark[];
  canSign: boolean;
  versions: VersionRow[];
  deliveryAddress: string;
  canCorrect: boolean;
};

type Order = {
  id: string;
  number: string;
  status: Status;
  total: string;
  counterparty: string;
  rejectionReason: string | null;
  creditHold: boolean;
  items: Item[];
  statusLogs: { toStatus: Status; createdAt: string; comment: string | null }[];
  disputeReason: string | null;
  documents: DocumentRow[];
  payments: { id: string; amount: string; reference: string | null }[];
  myRatingScore: string | null;
  counterpartyId: string;
  supplierRequisites: { iik: string | null; bik: string | null; bankName: string | null };
};

/** Следующие статусы, которые сторона двигает сама (раздел 5.2 ТЗ). */
const NEXT_BY_SIDE: Record<'store' | 'supplier', Partial<Record<Status, Status>>> = {
  supplier: { ACCEPTED: 'PICKING', PICKING: 'SHIPPED', SHIPPED: 'DELIVERED', PAID: 'CLOSED' },
  // Магазин принимает товар через приёмку, а не простой сменой статуса.
  // Закрыть оплаченную заявку может любая сторона — после этого открываются оценки (раздел 5.2 ТЗ).
  store: { PAID: 'CLOSED' },
};

export function OrderDetail({
  locale,
  side,
  order,
  onlinePayment,
  mockGateway,
  files,
  substituteOffers,
}: {
  locale: 'ru' | 'kk';
  side: 'store' | 'supplier';
  order: Order;
  substituteOffers: SubstituteOffer[];
  onlinePayment: OnlinePayment | null;
  mockGateway: boolean;
  files: { initial: FileRow[]; canUpload: boolean; canDelete: boolean };
}) {
  const t = useTranslations('orders');
  const tDocuments = useTranslations('documents');
  const tAcceptance = useTranslations('acceptance');
  const tPayment = useTranslations('payment');
  const tRatings = useTranslations('ratings');
  const tChat = useTranslations('chat');
  const router = useRouter();
  const [substitutes, setSubstitutes] = useState<
    Record<string, { offerId: string; quantity: string }>
  >({});
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries(
      order.items.map((item) => [item.id, item.quantityConfirmed ?? item.quantityOrdered]),
    ),
  );
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [acceptance, setAcceptance] = useState<
    Record<string, { accepted: string; defective: string; mismatch: string }>
  >(
    Object.fromEntries(
      order.items.map((item) => [
        item.id,
        {
          accepted: item.quantityConfirmed ?? item.quantityOrdered,
          defective: '0',
          mismatch: '0',
        },
      ]),
    ),
  );
  const [acceptanceResult, setAcceptanceResult] = useState<string | null>(null);
  const [payment, setPayment] = useState({
    amount: order.total,
    method: 'ON_DELIVERY' as 'PREPAY' | 'ON_DELIVERY' | 'DEFERRED',
    paidAt: new Date().toISOString().slice(0, 10),
    reference: '',
  });
  const [paymentResult, setPaymentResult] = useState<string | null>(null);
  // Раздел 3.8 ТЗ: магазин оценивает поставщика, поставщик — магазин.
  const ratingCriteria =
    side === 'store'
      ? (['quality', 'matching', 'politeness', 'packaging'] as const)
      : (['acceptance', 'communication'] as const);
  const [ratingValues, setRatingValues] = useState<Record<string, number>>(
    Object.fromEntries(ratingCriteria.map((key) => [key, 5])),
  );
  const [ratingComment, setRatingComment] = useState('');
  const [ratingResult, setRatingResult] = useState<string | null>(order.myRatingScore);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function post(path: string, body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { status?: string };
    setPending(false);

    if (!response.ok || (data.status && data.status !== 'ok' && data.status !== 'created')) {
      setError(data.status ?? 'unknown');
      return false;
    }
    router.refresh();
    return true;
  }

  /** Приёмка: отправляем фактические количества, брак и пересорт (раздел 6.2 демо-ТЗ). */
  async function submitAcceptance() {
    setPending(true);
    setError(null);

    const response = await fetch(`/api/orders/${order.id}/acceptance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        lines: order.items.map((item) => ({
          orderItemId: item.id,
          quantityAccepted: acceptance[item.id]?.accepted ?? '0',
          quantityDefective: acceptance[item.id]?.defective ?? '0',
          quantityMismatch: acceptance[item.id]?.mismatch ?? '0',
        })),
      }),
    });
    const data = (await response.json()) as {
      status: string;
      orderStatus?: string;
      total?: string;
    };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status);
      return;
    }
    setAcceptanceResult(
      `${data.orderStatus === 'ACCEPTED_WITH_DISCREPANCY' ? 'discrepancy' : 'clean'}:${data.total}`,
    );
    router.refresh();
  }

  /** Раздел 3.7 ТЗ: чат внутри заявки, с привязкой к ней. */
  async function openOrderChat() {
    setPending(true);
    setError(null);

    const response = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ counterpartyId: order.counterpartyId, orderId: order.id }),
    });
    const data = (await response.json()) as { status: string; chatId?: string };
    setPending(false);

    if (data.status !== 'ok' || !data.chatId) {
      setError(data.status);
      return;
    }
    router.push(`/chat?chat=${data.chatId}`);
  }

  /** Раздел 3.8 ТЗ: оценка по закрытой заявке, один раз от каждой стороны. */
  async function submitRating() {
    setPending(true);
    setError(null);

    const response = await fetch(`/api/orders/${order.id}/rating`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ criteria: ratingValues, comment: ratingComment }),
    });
    const data = (await response.json()) as { status: string; score?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status);
      return;
    }
    setRatingResult(data.score ?? null);
    router.refresh();
  }

  /** Раздел 3.6 ТЗ: отметка об оплате вручную. */
  async function submitPayment() {
    setPending(true);
    setError(null);

    const response = await fetch(`/api/orders/${order.id}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), ...payment }),
    });
    const data = (await response.json()) as { status: string; amount?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status);
      return;
    }
    setPaymentResult(data.amount ?? order.total);
    router.refresh();
  }

  const confirmLines = order.items.map((item) => ({
    orderItemId: item.id,
    quantityConfirmed: quantities[item.id] ?? item.quantityOrdered,
    substituteOfferId: substitutes[item.id]?.offerId || undefined,
    substituteQuantity: substitutes[item.id]?.offerId ? substitutes[item.id]!.quantity : undefined,
  }));
  const itemName = (id: string) => {
    const item = order.items.find((row) => row.id === id);
    return item ? (locale === 'kk' ? item.nameKk : item.nameRu) : '';
  };

  const nextStatus = NEXT_BY_SIDE[side][order.status];
  const canCreateDocuments =
    side === 'supplier' &&
    (order.status === 'ACCEPTED' || order.status === 'PICKING') &&
    order.documents.length === 0;
  const canAccept = side === 'store' && order.status === 'DELIVERED';
  const canRequestPayment =
    order.status === 'ACCEPTED_BY_STORE' || order.status === 'ACCEPTED_WITH_DISCREPANCY';
  const canPay = side === 'store' && order.status === 'AWAITING_PAYMENT';
  // Раздел 3.6 ТЗ: онлайн-оплата доступна и по просроченной заявке.
  const canPayOnline =
    side === 'store' && (order.status === 'AWAITING_PAYMENT' || order.status === 'OVERDUE');
  // Раздел 3.4 ТЗ: магазин может отменить заявку до статуса «Собирается», с причиной.
  const canRate = order.status === 'CLOSED' && order.myRatingScore === null;
  const canCancel =
    side === 'store' && ['SENT', 'ACCEPTED', 'CHANGED_BY_SUPPLIER'].includes(order.status);
  const canConfirm = side === 'supplier' && order.status === 'SENT';
  const canRespond = side === 'store' && order.status === 'CHANGED_BY_SUPPLIER';

  return (
    <Page>
      <PageHeader
        title={
          <span className="font-mono" data-testid="order-number">
            {order.number}
          </span>
        }
        description={order.counterparty}
        actions={
          <>
            <OrderStatusBadge status={order.status} testId="order-status" />
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              data-testid="open-order-chat"
              onClick={() => void openOrderChat()}
            >
              {tChat('openFromOrder')}
            </Button>
            <Link href="/orders" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('back')}
            </Link>
          </>
        }
      />

      <OrderProgress status={order.status} history={order.statusLogs.map((log) => log.toStatus)} />

      {order.creditHold && side === 'store' ? (
        <div
          className="border-warning/40 bg-warning-soft mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm"
          data-testid="credit-hold"
        >
          <p className="text-warning min-w-0 flex-1">{t('creditHold')}</p>
          <Button
            size="sm"
            disabled={pending}
            data-testid="credit-resend"
            onClick={() => void post(`/api/orders/${order.id}/resend`, {})}
          >
            {t('resend')}
          </Button>
        </div>
      ) : null}

      {order.status === 'CHANGED_BY_SUPPLIER' && side === 'store' ? (
        <p className="mt-3 text-sm text-amber-700" data-testid="order-changed-notice">
          {t('changedNotice')}
        </p>
      ) : null}
      {order.status === 'REJECTED' ? (
        <p className="mt-3 text-sm text-red-600" data-testid="order-rejected-notice">
          {t('rejectedNotice', { reason: order.rejectionReason ?? '' })}
        </p>
      ) : null}

      <section className="border-border bg-card shadow-card mt-5 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('items')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('ordered')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('confirmed')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('price')}</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y" data-testid="order-items">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 break-words">
                  {locale === 'kk' ? item.nameKk : item.nameRu}
                  {item.substituteForId ? (
                    <Badge tone="info" className="ml-2" data-testid={`substitute-${item.id}`}>
                      {t('substituteFor', { name: itemName(item.substituteForId) })}
                    </Badge>
                  ) : null}
                  {canConfirm ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`out-of-stock-${item.id}`}
                        onClick={() => setQuantities((current) => ({ ...current, [item.id]: '0' }))}
                      >
                        {t('outOfStock')}
                      </Button>
                      {substituteOffers.length > 0 ? (
                        <>
                          <select
                            className="border-input bg-background h-8 max-w-48 rounded-md border px-2 text-xs"
                            aria-label={t('substitute')}
                            value={substitutes[item.id]?.offerId ?? ''}
                            data-testid={`substitute-offer-${item.id}`}
                            onChange={(event) =>
                              setSubstitutes((current) => ({
                                ...current,
                                [item.id]: {
                                  offerId: event.target.value,
                                  quantity: current[item.id]?.quantity ?? item.quantityOrdered,
                                },
                              }))
                            }
                          >
                            <option value="">{t('substituteNone')}</option>
                            {substituteOffers.map((offer) => (
                              <option key={offer.id} value={offer.id}>
                                {offer.name} · {offer.priceWithVat} ₸
                              </option>
                            ))}
                          </select>
                          {substitutes[item.id]?.offerId ? (
                            <Input
                              className="h-8 w-20 text-right text-xs"
                              inputMode="decimal"
                              aria-label={t('substituteQuantity')}
                              value={substitutes[item.id]!.quantity}
                              data-testid={`substitute-qty-${item.id}`}
                              onChange={(event) =>
                                setSubstitutes((current) => ({
                                  ...current,
                                  [item.id]: { ...current[item.id]!, quantity: event.target.value },
                                }))
                              }
                            />
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{item.quantityOrdered}</td>
                <td className="px-3 py-2 text-right">
                  {canConfirm ? (
                    <Input
                      className="ml-auto h-9 w-24 text-right"
                      inputMode="decimal"
                      value={quantities[item.id] ?? ''}
                      data-testid={`confirm-qty-${item.id}`}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                  ) : (
                    <span className="tabular-nums" data-testid={`confirmed-${item.id}`}>
                      {item.quantityConfirmed ?? '—'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{item.priceWithVat}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-border border-t px-3 py-2 text-right text-sm">
          {t('total')}:{' '}
          <span className="font-medium tabular-nums" data-testid="order-total">
            {order.total}
          </span>{' '}
          ₸
        </p>
      </section>

      <section className="mt-5 space-y-3">
        {canConfirm ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              data-testid="accept-full"
              onClick={() =>
                void post(`/api/orders/${order.id}/confirm`, {
                  idempotencyKey: crypto.randomUUID(),
                  lines: order.items.map((item) => ({
                    orderItemId: item.id,
                    quantityConfirmed: item.quantityOrdered,
                  })),
                })
              }
            >
              {t('acceptFull')}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              data-testid="accept-partial"
              onClick={() =>
                void post(`/api/orders/${order.id}/confirm`, {
                  idempotencyKey: crypto.randomUUID(),
                  lines: confirmLines,
                })
              }
            >
              {t('acceptPartial')}
            </Button>
          </div>
        ) : null}

        {canConfirm ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label={t('rejectReason')}>
                <Input
                  value={reason}
                  data-testid="reject-reason"
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            </div>
            <Button
              variant="ghost"
              disabled={pending}
              data-testid="reject-order"
              onClick={() =>
                void post(`/api/orders/${order.id}/status`, {
                  status: 'REJECTED',
                  comment: reason,
                })
              }
            >
              {t('reject')}
            </Button>
          </div>
        ) : null}

        {canRespond ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              data-testid="agree-changes"
              onClick={() => void post(`/api/orders/${order.id}/respond`, { agree: true })}
            >
              {t('agree')}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              data-testid="disagree-changes"
              onClick={() => void post(`/api/orders/${order.id}/respond`, { agree: false })}
            >
              {t('disagree')}
            </Button>
          </div>
        ) : null}

        {nextStatus ? (
          <Button
            variant="outline"
            disabled={pending}
            data-testid="next-status"
            onClick={() => void post(`/api/orders/${order.id}/status`, { status: nextStatus })}
          >
            {t('nextStatus')}: {t(`status.${nextStatus}`)}
          </Button>
        ) : null}

        {error ? (
          <p className="text-sm text-red-600" role="alert" data-testid="order-error">
            {t(`errors.${error}` as 'errors.unknown')}
          </p>
        ) : null}
      </section>

      {canCreateDocuments ? (
        <section className="mt-5">
          <Button
            disabled={pending}
            data-testid="create-documents"
            onClick={() =>
              void post(`/api/orders/${order.id}/documents`, {
                idempotencyKey: crypto.randomUUID(),
              })
            }
          >
            {pending ? tDocuments('creating') : tDocuments('create')}
          </Button>
        </section>
      ) : null}

      {order.documents.length > 0 ? (
        <section className="border-border bg-card shadow-card mt-5 rounded-xl border p-4 sm:p-5">
          <h2 className="text-muted-foreground text-sm font-medium">{tDocuments('title')}</h2>
          <ul className="mt-2 space-y-3 text-sm" data-testid="order-documents">
            {order.documents.map((document) => (
              <li
                key={document.id}
                className="space-y-1.5"
                data-testid={`document-${document.type}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {tDocuments(`types.${document.type}`)} № {document.number}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{document.totalWithVat} ₸</span>
                    <a
                      href={`/api/documents/${document.id}/pdf?locale=${locale}`}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      data-testid={`document-pdf-${document.type}`}
                    >
                      {tDocuments('open')}
                    </a>
                    <a
                      href={`/api/documents/${document.id}/xlsx?locale=${locale}`}
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      data-testid={`document-xlsx-${document.type}`}
                    >
                      {tDocuments('excel')}
                    </a>
                  </span>
                </div>
                <DocumentSignatures
                  documentId={document.id}
                  signatures={document.signatures}
                  canSign={document.canSign}
                />
                <DocumentVersions
                  documentId={document.id}
                  locale={locale}
                  versions={document.versions}
                  deliveryAddress={document.deliveryAddress}
                  canCorrect={document.canCorrect}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canAccept ? (
        <section className="border-border bg-card shadow-card mt-5 rounded-xl border p-4 sm:p-5">
          <h2 className="text-lg font-medium">{tAcceptance('title')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">{tAcceptance('hint')}</p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('items')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{tAcceptance('shipped')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{tAcceptance('accepted')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{tAcceptance('defective')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{tAcceptance('mismatch')}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y" data-testid="acceptance-items">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3 break-words">
                      {locale === 'kk' ? item.nameKk : item.nameRu}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {item.quantityConfirmed ?? item.quantityOrdered}
                    </td>
                    {(['accepted', 'defective', 'mismatch'] as const).map((field) => (
                      <td key={field} className="py-2 pr-3 text-right">
                        <Input
                          className="ml-auto h-9 w-24 text-right"
                          inputMode="decimal"
                          value={acceptance[item.id]?.[field] ?? ''}
                          data-testid={`acceptance-${field}-${item.id}`}
                          onChange={(event) =>
                            setAcceptance((current) => ({
                              ...current,
                              [item.id]: { ...current[item.id]!, [field]: event.target.value },
                            }))
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button
            className="mt-3"
            disabled={pending}
            data-testid="submit-acceptance"
            onClick={() => void submitAcceptance()}
          >
            {pending ? tAcceptance('submitting') : tAcceptance('submit')}
          </Button>
        </section>
      ) : null}
      {acceptanceResult ? (
        <p className="mt-4 text-sm" data-testid="acceptance-result">
          {acceptanceResult.startsWith('discrepancy')
            ? tAcceptance('doneDiscrepancy')
            : tAcceptance('doneClean')}{' '}
          {tAcceptance('newTotal', { total: acceptanceResult.split(':')[1] ?? '' })}
        </p>
      ) : null}

      {canCancel ? (
        <section className="mt-5 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t('cancelReason')}>
              <Input
                value={cancelReason}
                data-testid="cancel-reason"
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </Field>
          </div>
          <Button
            variant="ghost"
            disabled={pending}
            data-testid="cancel-order"
            onClick={() =>
              void post(`/api/orders/${order.id}/status`, {
                status: 'CANCELLED',
                comment: cancelReason,
              })
            }
          >
            {t('cancel')}
          </Button>
        </section>
      ) : null}

      {canRequestPayment ? (
        <section className="mt-5">
          <Button
            variant="outline"
            disabled={pending}
            data-testid="to-payment"
            onClick={() =>
              void post(`/api/orders/${order.id}/status`, { status: 'AWAITING_PAYMENT' })
            }
          >
            {tPayment('toPayment')}
          </Button>
        </section>
      ) : null}

      {canPayOnline ? (
        <OnlinePaymentPanel orderId={order.id} initial={onlinePayment} mockGateway={mockGateway} />
      ) : null}

      {canPay ? (
        <section className="border-border bg-card shadow-card mt-5 rounded-xl border p-4 sm:p-5">
          <h2 className="text-lg font-medium">{tPayment('title')}</h2>

          <dl className="mt-3 space-y-1 text-sm" data-testid="payment-requisites">
            <p className="text-muted-foreground text-xs">{tPayment('payTo')}</p>
            {order.supplierRequisites.iik ? (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{tPayment('iik')}</dt>
                  <dd className="font-mono" data-testid="payment-iik">
                    {order.supplierRequisites.iik}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{tPayment('bik')}</dt>
                  <dd className="font-mono" data-testid="payment-bik">
                    {order.supplierRequisites.bik}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{tPayment('bank')}</dt>
                  <dd>{order.supplierRequisites.bankName}</dd>
                </div>
              </>
            ) : (
              <p className="text-sm text-red-600">{tPayment('noRequisites')}</p>
            )}
          </dl>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tPayment('amount')}>
              <Input
                inputMode="decimal"
                value={payment.amount}
                data-testid="payment-amount"
                onChange={(event) =>
                  setPayment((current) => ({ ...current, amount: event.target.value }))
                }
              />
            </Field>
            <Field label={tPayment('method')}>
              <select
                className="border-border bg-card h-11 w-full rounded-lg border px-3"
                value={payment.method}
                data-testid="payment-method"
                onChange={(event) =>
                  setPayment((current) => ({
                    ...current,
                    method: event.target.value as typeof current.method,
                  }))
                }
              >
                {(['PREPAY', 'ON_DELIVERY', 'DEFERRED'] as const).map((method) => (
                  <option key={method} value={method}>
                    {tPayment(`methods.${method}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tPayment('paidAt')}>
              <Input
                type="date"
                value={payment.paidAt}
                data-testid="payment-date"
                onChange={(event) =>
                  setPayment((current) => ({ ...current, paidAt: event.target.value }))
                }
              />
            </Field>
            <Field label={tPayment('reference')}>
              <Input
                value={payment.reference}
                data-testid="payment-reference"
                onChange={(event) =>
                  setPayment((current) => ({ ...current, reference: event.target.value }))
                }
              />
            </Field>
          </div>

          <Button
            className="mt-3"
            disabled={pending}
            data-testid="submit-payment"
            onClick={() => void submitPayment()}
          >
            {pending ? tPayment('submitting') : tPayment('submit')}
          </Button>
        </section>
      ) : null}

      {paymentResult ? (
        <p className="mt-4 text-sm" data-testid="payment-result">
          {tPayment('done', { amount: paymentResult })}
        </p>
      ) : null}

      {order.payments.length > 0 ? (
        <section className="border-border bg-card shadow-card mt-5 rounded-xl border p-4 sm:p-5">
          <h2 className="text-muted-foreground text-sm font-medium">{tPayment('title')}</h2>
          <ul className="mt-2 space-y-1 text-sm" data-testid="order-payments">
            {order.payments.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span>{item.reference ?? '—'}</span>
                <span className="tabular-nums">{item.amount} ₸</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {canRate ? (
        <section className="border-border bg-card shadow-card mt-5 rounded-xl border p-4 sm:p-5">
          <h2 className="text-lg font-medium">{tRatings('rateOrder')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">{tRatings('rateHint')}</p>

          <div className="mt-3 space-y-2">
            {ratingCriteria.map((criterion) => (
              <label
                key={criterion}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span>{tRatings(`criteria.${criterion}`)}</span>
                <select
                  className="border-border bg-card h-9 rounded-lg border px-2"
                  value={ratingValues[criterion] ?? 5}
                  data-testid={`rating-${criterion}`}
                  onChange={(event) =>
                    setRatingValues((current) => ({
                      ...current,
                      [criterion]: Number(event.target.value),
                    }))
                  }
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-3">
            <Field label={tRatings('comment')}>
              <Input
                value={ratingComment}
                data-testid="rating-comment"
                onChange={(event) => setRatingComment(event.target.value)}
              />
            </Field>
          </div>

          <Button
            className="mt-3"
            disabled={pending}
            data-testid="submit-rating"
            onClick={() => void submitRating()}
          >
            {tRatings('submit')}
          </Button>
        </section>
      ) : null}

      {ratingResult ? (
        <p className="mt-4 text-sm" data-testid="rating-result">
          {tRatings('submitted', { score: ratingResult })}
        </p>
      ) : null}
      {order.disputeReason ? (
        <p className="mt-4 text-sm" data-testid="dispute-reason">
          <span className="text-muted-foreground">{t('disputeReason')}: </span>
          {order.disputeReason}
        </p>
      ) : null}

      <AttachmentsPanel
        orderId={order.id}
        initialFiles={files.initial}
        canUpload={files.canUpload}
        canDelete={files.canDelete}
      />

      <section className="mt-6">
        <h2 className="text-muted-foreground text-sm font-medium">{t('history')}</h2>
        <ol
          className="border-border mt-3 ml-1.5 space-y-3 border-l pl-4 text-sm"
          data-testid="status-history"
        >
          {order.statusLogs.map((log, index) => (
            <li
              key={`${log.toStatus}-${index}`}
              className="before:bg-primary before:ring-background relative flex flex-wrap items-baseline justify-between gap-2 before:absolute before:top-1.5 before:-left-[21px] before:size-2.5 before:rounded-full before:ring-4"
            >
              <span>
                {t(`status.${log.toStatus}`)}
                {log.comment ? (
                  <span className="text-muted-foreground"> — {log.comment}</span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs">{log.createdAt}</span>
            </li>
          ))}
        </ol>
      </section>
    </Page>
  );
}
