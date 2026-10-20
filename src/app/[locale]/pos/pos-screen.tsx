'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardTitle } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/ui/page';

type Item = { productId: string; name: string; barcode: string; price: string; quantity: string };
type Shift = { id: string; number: string; openedAt: string } | null;
type Report = {
  receipts: number;
  refunds: number;
  total: string;
  byPayment: { CASH: string; CARD: string; QR: string };
  expectedCash: string;
} | null;

const QUEUE_KEY = 'pos-offline-queue';
const PAYMENTS = ['CASH', 'CARD', 'QR'] as const;

type QueuedSale = {
  clientId: string;
  paymentType: (typeof PAYMENTS)[number];
  lines: { productId: string; quantity: string }[];
};

/** Очередь офлайн-чеков переживает перезагрузку: хранится в браузере кассы. */
function readQueue(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedSale[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSale[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Приватный режим браузера: очередь живёт только в памяти.
  }
}

/** Касса (раздел 4.2 ТЗ): продажа, возврат, смена и Z-отчёт, работа без сети. */
export function PosScreen({
  products,
  initialShift,
  initialReport,
}: {
  products: Item[];
  initialShift: Shift;
  initialReport: Report;
}) {
  const t = useTranslations('pos');

  const [shift, setShift] = useState<Shift>(initialShift);
  const [report, setReport] = useState<Report>(initialReport);
  const [cart, setCart] = useState<Item[]>([]);
  const [scan, setScan] = useState('');
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]>('CASH');
  const [cash, setCash] = useState('0');
  const [queued, setQueued] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ id: string; number: string } | null>(null);
  const [pending, setPending] = useState(false);

  // Очередь офлайн-чеков уходит на сервер, как только появляется связь.
  useEffect(() => {
    const sync = () => {
      void flushQueue();
    };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Отправка отложенных чеков: идентификатор чека делает повтор безопасным. */
  async function flushQueue() {
    const queue = readQueue();
    const left: QueuedSale[] = [];

    for (const sale of queue) {
      try {
        const response = await fetch('/api/pos/sale', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sale),
        });
        if (!response.ok) left.push(sale);
      } catch {
        left.push(sale);
      }
    }

    writeQueue(left);
    setQueued(left.length);
    if (left.length < queue.length) await refresh();
  }

  async function refresh() {
    const response = await fetch('/api/pos/shift');
    if (!response.ok) return;
    const data = (await response.json()) as { shift: Shift; report: Report };
    setShift(data.shift);
    setReport(data.report);
  }

  const total = cart.reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity || '0'),
    0,
  );

  function addByBarcode(code: string) {
    const found = products.find((product) => product.barcode === code.trim());
    setScan('');
    if (!found) {
      setError('not_found');
      return;
    }
    setError(null);
    setCart((current) => {
      const existing = current.find((item) => item.productId === found.productId);
      if (!existing) return [...current, { ...found, quantity: '1' }];
      return current.map((item) =>
        item.productId === found.productId
          ? { ...item, quantity: String(Number(item.quantity) + 1) }
          : item,
      );
    });
  }

  async function sell() {
    if (cart.length === 0) return;
    setPending(true);
    setError(null);
    setNotice(null);

    const sale: QueuedSale = {
      clientId: crypto.randomUUID(),
      paymentType: payment,
      lines: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    };

    try {
      const response = await fetch('/api/pos/sale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sale),
      });
      const data = (await response.json()) as {
        status?: string;
        number?: string;
        receiptId?: string;
      };
      if (data.status !== 'ok') {
        setError(data.status ?? 'unknown');
        setPending(false);
        return;
      }
      setLastReceipt({ id: data.receiptId!, number: data.number! });
      setNotice('sold');
      setCart([]);
      await refresh();
    } catch {
      // Связи нет: чек ждёт синхронизации, касса продолжает работать.
      const queue = [...readQueue(), sale];
      writeQueue(queue);
      setQueued(queue.length);
      setNotice('queued');
      setCart([]);
    }
    setPending(false);
  }

  async function shiftAction(action: 'open' | 'close') {
    setPending(true);
    setError(null);
    const response = await fetch('/api/pos/shift', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, shiftId: shift?.id, cash }),
    });
    const data = (await response.json()) as { status?: string };
    setPending(false);
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    await refresh();
  }

  async function refundLast() {
    if (!lastReceipt) return;
    setPending(true);
    const response = await fetch('/api/pos/refund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receiptId: lastReceipt.id }),
    });
    const data = (await response.json()) as { status?: string };
    setPending(false);
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    setNotice('refunded');
    setLastReceipt(null);
    await refresh();
  }

  return (
    <Page width="lg">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Card data-testid="pos-shift">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="text-sm">
              {shift ? t('shiftOpen', { number: shift.number }) : t('shiftClosed')}
            </CardTitle>
            {report ? (
              <p className="text-muted-foreground mt-1 text-sm" data-testid="pos-report">
                {t('reportLine', {
                  receipts: report.receipts,
                  total: report.total,
                  cash: report.expectedCash,
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('cash')}>
              <Input
                className="w-28"
                inputMode="decimal"
                value={cash}
                data-testid="pos-cash"
                onChange={(event) => setCash(event.target.value)}
              />
            </Field>
            <Button
              variant={shift ? 'outline' : 'default'}
              disabled={pending}
              data-testid={shift ? 'close-shift' : 'open-shift'}
              onClick={() => void shiftAction(shift ? 'close' : 'open')}
            >
              {shift ? t('closeShift') : t('openShift')}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <CardTitle className="text-sm">{t('sale')}</CardTitle>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label={t('scan')}>
            <Input
              className="w-48"
              value={scan}
              placeholder={t('scanPlaceholder')}
              data-testid="pos-scan"
              onChange={(event) => setScan(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addByBarcode(scan);
              }}
            />
          </Field>

          <Field label={t('product')}>
            <select
              className="border-border bg-card h-11 rounded-lg border px-3"
              data-testid="pos-product"
              defaultValue=""
              onChange={(event) => {
                const product = products.find((item) => item.productId === event.target.value);
                if (product) addByBarcode(product.barcode);
                event.target.value = '';
              }}
            >
              <option value="">—</option>
              {products.map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.name} · {product.price} ₸
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('payment')}>
            <select
              className="border-border bg-card h-11 rounded-lg border px-3"
              value={payment}
              data-testid="pos-payment"
              onChange={(event) => setPayment(event.target.value as (typeof PAYMENTS)[number])}
            >
              {PAYMENTS.map((type) => (
                <option key={type} value={type}>
                  {t(`payments.${type}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {cart.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm" data-testid="pos-cart">
            {cart.map((item) => (
              <li key={item.productId} className="flex flex-wrap justify-between gap-2">
                <span className="break-words">{item.name}</span>
                <span className="tabular-nums">
                  {item.quantity} × {item.price} ₸
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xl font-semibold tabular-nums" data-testid="pos-total">
            {total.toFixed(2)} ₸
          </span>
          <Button
            disabled={pending || cart.length === 0}
            data-testid="pos-sell"
            onClick={() => void sell()}
          >
            {t('sell')}
          </Button>
          {lastReceipt ? (
            <Button
              variant="outline"
              disabled={pending}
              data-testid="pos-refund"
              onClick={() => void refundLast()}
            >
              {t('refund', { number: lastReceipt.number })}
            </Button>
          ) : null}
          {queued > 0 ? (
            <span className="text-muted-foreground text-sm" data-testid="pos-queued">
              {t('queued', { count: queued })}
            </span>
          ) : null}
        </div>

        {notice ? (
          <p className="text-muted-foreground mt-2 text-sm" data-testid="pos-notice">
            {t(`notices.${notice}` as 'notices.sold')}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-red-600" role="alert" data-testid="pos-error">
            {t(`errors.${error}` as 'errors.unknown')}
          </p>
        ) : null}
      </Card>
    </Page>
  );
}
