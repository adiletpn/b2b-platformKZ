'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Link, useRouter } from '@/i18n/navigation';
import type { CartSupplierGroup } from '@/lib/cart/cart';

export function CartScreen({
  locale,
  initialGroups,
}: {
  locale: 'ru' | 'kk';
  initialGroups: CartSupplierGroup[];
}) {
  const t = useTranslations('cart');
  const tOrders = useTranslations('orders');
  const tPayment = useTranslations('payment');
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [roundedNotice, setRoundedNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [orderFields, setOrderFields] = useState({
    deliveryDate: '',
    comment: '',
    paymentMethod: 'ON_DELIVERY' as 'PREPAY' | 'ON_DELIVERY' | 'DEFERRED',
  });

  async function save(offerId: string, value: string) {
    const response = await fetch('/api/cart/item', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerId, quantity: value || '0' }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as {
      groups: CartSupplierGroup[];
      quantity: string;
      rounded: boolean;
    };
    setGroups(data.groups);
    setRoundedNotice(data.rounded ? data.quantity : null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[offerId];
      return next;
    });
  }

  /** Раздел 3.4 ТЗ: один клик создаёт отдельную заявку на каждого поставщика. */
  async function send() {
    setSending(true);
    setSendResult(null);

    type SendResponse = {
      status: string;
      orders?: { number: string }[];
      suppliers?: { supplierName: string; missing: string }[];
    };

    let data: SendResponse = { status: 'unknown' };
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Правило 10: ключ идемпотентности защищает от двойного нажатия.
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          deliveryDate: orderFields.deliveryDate || undefined,
          comment: orderFields.comment || undefined,
          paymentMethod: orderFields.paymentMethod,
        }),
      });
      // Ошибка сервера может прийти не в JSON — кнопка не должна залипать.
      data = (await response.json()) as SendResponse;
    } catch {
      data = { status: 'unknown' };
    } finally {
      setSending(false);
    }

    if (data.status === 'created') {
      setGroups([]);
      setSendResult(`created:${data.orders?.length ?? 0}`);
      router.push('/orders');
      return;
    }
    if (data.status === 'below_minimum') {
      setSendResult(`below:${(data.suppliers ?? []).map((item) => item.supplierName).join(', ')}`);
      return;
    }
    setSendResult('empty');
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/feed" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('backToFeed')}
        </Link>
      </header>

      {groups.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm" data-testid="cart-empty">
          {t('empty')}
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 text-sm" data-testid="cart-suppliers-count">
            {t('suppliersCount', { count: groups.length })}
          </p>

          {roundedNotice ? (
            <p className="mt-2 text-sm text-amber-700" data-testid="cart-rounded-notice">
              {t('roundedNotice', { quantity: roundedNotice })}
            </p>
          ) : null}

          <section className="border-border bg-card mt-4 grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-3">
            <Field label={tOrders('deliveryDate')}>
              <Input
                type="date"
                value={orderFields.deliveryDate}
                data-testid="order-delivery-date"
                onChange={(event) =>
                  setOrderFields((current) => ({ ...current, deliveryDate: event.target.value }))
                }
              />
            </Field>
            <Field label={tOrders('paymentMethod')}>
              <select
                className="border-border bg-card h-11 w-full rounded-lg border px-3"
                value={orderFields.paymentMethod}
                data-testid="order-payment-method"
                onChange={(event) =>
                  setOrderFields((current) => ({
                    ...current,
                    paymentMethod: event.target.value as typeof current.paymentMethod,
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
            <Field label={tOrders('comment')}>
              <Input
                value={orderFields.comment}
                data-testid="order-comment"
                onChange={(event) =>
                  setOrderFields((current) => ({ ...current, comment: event.target.value }))
                }
              />
            </Field>
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={send} disabled={sending} data-testid="send-orders">
              {sending ? tOrders('sending') : tOrders('send')}
            </Button>
            {sendResult ? (
              <p className="text-sm" data-testid="send-result">
                {sendResult.startsWith('created:')
                  ? tOrders('sent', { count: Number(sendResult.split(':')[1]) })
                  : sendResult.startsWith('below:')
                    ? tOrders('belowMinimum', { suppliers: sendResult.slice(6) })
                    : tOrders('emptyCart')}
              </p>
            ) : null}
          </div>

          <div className="mt-4 space-y-4">
            {groups.map((group) => (
              <section
                key={group.supplierId}
                className="border-border bg-card rounded-lg border p-4"
                data-testid={`cart-group-${group.supplierId}`}
              >
                <h2 className="font-medium break-words">{group.supplierName}</h2>

                <ul className="divide-border mt-3 divide-y">
                  {group.items.map((item) => (
                    <li key={item.offerId} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 text-sm break-words">
                        {locale === 'kk' ? item.nameKk : item.nameRu}
                      </span>
                      <Input
                        className="h-9 w-24 text-right"
                        inputMode="decimal"
                        value={drafts[item.offerId] ?? item.quantity}
                        data-testid={`cart-qty-${item.offerId}`}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [item.offerId]: event.target.value,
                          }))
                        }
                        onBlur={(event) => void save(item.offerId, event.target.value)}
                      />
                      <span className="w-28 text-right text-sm tabular-nums">
                        {item.lineTotal} ₸
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void save(item.offerId, '0')}
                        data-testid={`cart-remove-${item.offerId}`}
                      >
                        {t('remove')}
                      </Button>
                    </li>
                  ))}
                </ul>

                <dl className="border-border mt-3 space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('supplierTotal')}</dt>
                    <dd
                      className="font-medium tabular-nums"
                      data-testid={`cart-total-${group.supplierId}`}
                    >
                      {group.total} ₸
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('minOrder')}</dt>
                    <dd className="tabular-nums">{group.minOrderAmount} ₸</dd>
                  </div>
                  {group.meetsMinimum ? (
                    <p
                      className="text-muted-foreground text-xs"
                      data-testid={`cart-ok-${group.supplierId}`}
                    >
                      {t('meetsMinimum')}
                    </p>
                  ) : (
                    <p
                      className="text-xs text-red-600"
                      data-testid={`cart-missing-${group.supplierId}`}
                    >
                      {t('missing', { amount: group.missingToMinimum })}
                    </p>
                  )}
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
