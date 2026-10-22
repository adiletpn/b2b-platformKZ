'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Decimal from 'decimal.js';
import { X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Link, useRouter } from '@/i18n/navigation';
import type { CartSupplierGroup } from '@/lib/cart/cart';
import { Avatar, Progress, Stepper } from '@/components/ui/controls';
import { ProductPhoto } from '@/components/product-photo';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { money, quantity as trimZeros } from '@/lib/format';
import { cn } from '@/lib/utils';

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

  /** Шаг степпера — кратность упаковки, «−» до нуля убирает позицию. */
  function step(item: CartSupplierGroup['items'][number], direction: 1 | -1) {
    const next = new Decimal(item.quantity).plus(new Decimal(item.packSize).times(direction));
    void save(item.offerId, Decimal.max(next, 0).toFixed(3));
  }

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
      orders?: { number: string; needsApproval: boolean }[];
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
      // Раздел 3.12 ТЗ: заявка выше лимита сотрудника поставщику пока не ушла.
      if ((data.orders ?? []).some((order) => order.needsApproval)) {
        setSendResult('approval');
        return;
      }
      setSendResult(`created:${data.orders?.length ?? 0}`);
      router.push('/orders');
      return;
    }
    if (data.status === 'license_required') {
      setSendResult('license');
      return;
    }
    if (data.status === 'below_minimum') {
      setSendResult(`below:${(data.suppliers ?? []).map((item) => item.supplierName).join(', ')}`);
      return;
    }
    setSendResult('empty');
  }

  const itemsCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const total = groups.reduce((sum, group) => sum.plus(group.total), new Decimal(0)).toFixed(2);

  return (
    <Page width="lg">
      <PageHeader
        title={t('title')}
        description={
          groups.length > 0 ? (
            <span data-testid="cart-suppliers-count">
              {t('suppliersCount', { count: groups.length })} ·{' '}
              {t('itemsCount', { count: itemsCount })}
            </span>
          ) : undefined
        }
        actions={
          <Link href="/feed" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('backToFeed')}
          </Link>
        }
      />

      {groups.length === 0 ? (
        <EmptyState>
          <span data-testid="cart-empty">{t('empty')}</span>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-2.5">
            {roundedNotice ? (
              <p
                className="bg-primary-soft text-primary-text rounded-2xl px-4 py-2.5 text-sm font-bold"
                data-testid="cart-rounded-notice"
              >
                {t('roundedNotice', { quantity: roundedNotice })}
              </p>
            ) : null}

            {groups.map((group, index) => {
              const minimum = new Decimal(group.minOrderAmount);
              const percent = minimum.isZero()
                ? 100
                : new Decimal(group.total).div(minimum).times(100).toNumber();
              return (
                <section
                  key={group.supplierId}
                  className="border-border bg-card flex flex-col gap-2.5 rounded-[20px] border p-3.5"
                  data-testid={`cart-group-${group.supplierId}`}
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar name={group.supplierName} tone={index % 2 === 1 ? 'dark' : 'primary'} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-[15px] font-extrabold">{group.supplierName}</h2>
                      <p className="text-muted-foreground text-xs font-semibold">
                        {t('itemsCount', { count: group.items.length })}
                      </p>
                    </div>
                    <p
                      className="text-[15px] font-black whitespace-nowrap tabular-nums"
                      data-testid={`cart-total-${group.supplierId}`}
                    >
                      {money(group.total)} ₸
                    </p>
                  </div>

                  <ul className="space-y-2.5">
                    {group.items.map((item) => {
                      const name = locale === 'kk' ? item.nameKk : item.nameRu;
                      const unit = locale === 'kk' ? item.unitKk : item.unitRu;
                      return (
                        <li key={item.offerId} className="flex items-center gap-2.5">
                          <ProductPhoto
                            size="sm"
                            src={item.photoUrl}
                            name={name}
                            className="size-10"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-bold">{name}</p>
                            <p
                              className="text-muted-foreground truncate text-xs font-semibold"
                              data-testid={`cart-terms-${item.offerId}`}
                            >
                              {t('itemTerms', {
                                price: money(item.priceWithVat),
                                unit,
                                packSize: trimZeros(item.packSize),
                                minBatch: trimZeros(item.minBatch),
                              })}
                            </p>
                          </div>
                          <Stepper
                            value={
                              drafts[item.offerId] ?? trimZeros(item.quantity).replace(',', '.')
                            }
                            onDecrease={() => step(item, -1)}
                            onIncrease={() => step(item, 1)}
                            inputProps={{
                              'aria-label': name,
                              // @ts-expect-error data-атрибут для автотестов
                              'data-testid': `cart-qty-${item.offerId}`,
                              onChange: (event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [item.offerId]: event.target.value,
                                })),
                              onBlur: (event) => void save(item.offerId, event.target.value),
                            }}
                          />
                          <span className="hidden w-24 text-right text-[13px] font-extrabold tabular-nums sm:block">
                            {money(item.lineTotal)} ₸
                          </span>
                          <button
                            type="button"
                            aria-label={t('remove')}
                            title={t('remove')}
                            className="text-muted-foreground hover:text-danger grid size-8 shrink-0 place-items-center rounded-full"
                            onClick={() => void save(item.offerId, '0')}
                            data-testid={`cart-remove-${item.offerId}`}
                          >
                            <X className="size-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  <Progress value={percent} tone={group.meetsMinimum ? 'success' : 'primary'} />
                  {group.meetsMinimum ? (
                    <p
                      className="text-success text-xs font-bold"
                      data-testid={`cart-ok-${group.supplierId}`}
                    >
                      {t('minReached', { min: money(group.minOrderAmount) })}
                    </p>
                  ) : (
                    <p
                      className="text-primary-text text-xs font-bold"
                      data-testid={`cart-missing-${group.supplierId}`}
                    >
                      {t('missing', { amount: money(group.missingToMinimum) })}
                    </p>
                  )}
                </section>
              );
            })}

            <section className="border-border bg-card grid grid-cols-1 gap-3 rounded-[20px] border p-4 sm:grid-cols-3">
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
                  className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3 font-medium"
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
          </div>

          {/* «Итого» и отправка: на телефоне прилипает над вкладками (M06), на компьютере справа. */}
          <aside className="bg-background/95 lg:border-border lg:bg-card sticky bottom-[78px] z-20 -mx-5 flex items-center gap-3 px-5 py-3 backdrop-blur lg:static lg:mx-0 lg:w-[320px] lg:flex-col lg:items-stretch lg:rounded-[20px] lg:border lg:p-[22px]">
            <div className="lg:flex lg:items-baseline lg:justify-between">
              <p className="text-muted-foreground text-xs font-semibold lg:text-sm">{t('total')}</p>
              <p className="text-xl font-black tabular-nums lg:text-2xl">{money(total)} ₸</p>
            </div>
            <Button
              size="lg"
              className={cn('flex-1 lg:flex-none')}
              onClick={send}
              disabled={sending}
              data-testid="send-orders"
            >
              {sending ? tOrders('sending') : t('sendCount', { count: groups.length })}
            </Button>
          </aside>
        </div>
      )}

      {sendResult ? (
        <p className="mt-3 text-sm font-bold" data-testid="send-result">
          {sendResult.startsWith('created:')
            ? tOrders('sent', { count: Number(sendResult.split(':')[1]) })
            : sendResult === 'approval'
              ? tOrders('awaitingApproval')
              : sendResult === 'license'
                ? tOrders('licenseRequired')
                : sendResult.startsWith('below:')
                  ? tOrders('belowMinimum', { suppliers: sendResult.slice(6) })
                  : tOrders('emptyCart')}
        </p>
      ) : null}
    </Page>
  );
}
