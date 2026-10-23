'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Banknote,
  CreditCard,
  Minus,
  PauseCircle,
  Plus,
  QrCode,
  ScanBarcode,
  Search,
  Split,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardHint, CardTitle } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { CameraScanButton } from '@/components/camera-scanner';
import { NotYetButton } from '@/components/ui/not-yet';
import { money as formatMoney } from '@/lib/format';

type Product = {
  productId: string;
  name: string;
  barcode: string;
  price: string;
  stock: string;
  /** Маркированный: каждая единица продаётся со своим кодом DataMatrix. */
  isMarked: boolean;
  /** Подакцизный: часы продажи и подтверждение возраста. */
  isExcise: boolean;
  /** Продажа поштучно из упаковки: штук в упаковке и цена штуки (разделы 4.1 и 4.2 ТЗ). */
  piecesPerPack: number | null;
  piecePrice: string | null;
};
type Line = Product & {
  /** Товар может лежать в чеке дважды: упаковкой и штуками. */
  key: string;
  byPiece: boolean;
  quantity: string;
  discountPercent: string;
  markingCodes: string[];
};
type Shift = { id: string; number: string; openedAt: string } | null;
type Report = {
  receipts: number;
  refunds: number;
  total: string;
  byPayment: { CASH: string; CARD: string; QR: string; BONUS: string };
  bonusEarned: string;
  discounts: string;
  margin: string;
  averageCheck: string;
  openingCash: string;
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  byCashier: { name: string; receipts: number; total: string }[];
  topProducts: { nameRu: string; nameKk: string; quantity: string; total: string }[];
} | null;

const QUEUE_KEY = 'pos-offline-queue';
const HELD_KEY = 'pos-held-receipts';
const PAYMENTS = ['CASH', 'CARD', 'QR', 'MIXED'] as const;
const PAYMENT_ICONS = { CASH: Banknote, CARD: CreditCard, QR: QrCode, MIXED: Split } as const;

type QueuedSale = {
  clientId: string;
  paymentType: (typeof PAYMENTS)[number];
  lines: {
    productId: string;
    quantity: string;
    discountPercent?: string;
    markingCodes?: string[];
    byPiece?: boolean;
  }[];
  ageConfirmed?: boolean;
  customerPhone?: string;
  bonusRedeem?: string;
  receiptDiscountPercent?: string;
  cashAmount?: string;
  cardAmount?: string;
  cashReceived?: string;
};

type HeldReceipt = { id: string; at: string; lines: Line[]; receiptDiscount: string };

/** Очереди кассы переживают перезагрузку: хранятся в браузере. */
function readStored<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function writeStored<T>(key: string, value: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Приватный режим браузера: очередь живёт только в памяти.
  }
}

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** Предпросмотр суммы в интерфейсе; точный расчёт копеек делает сервер (receipt-math). */
function previewTotals(lines: Line[], receiptDiscount: string) {
  const subtotal = lines.reduce((sum, line) => {
    const gross = Number(line.price) * Number(line.quantity || '0');
    return sum + gross * (1 - Number(line.discountPercent || '0') / 100);
  }, 0);
  const gross = lines.reduce(
    (sum, line) => sum + Number(line.price) * Number(line.quantity || '0'),
    0,
  );
  const total = subtotal * (1 - Number(receiptDiscount || '0') / 100);
  return { gross, total: Math.round(total * 100) / 100 };
}

/**
 * Касса (раздел 4.2 ТЗ): плитки товаров и сканер, скидки на позицию и чек, наличные со
 * сдачей, карта, Kaspi QR и смешанная оплата, отложенные чеки, X/Z-отчёт, внесение и
 * изъятие наличных. Без сети чеки копятся в очереди и уходят по `clientId` без дублей.
 */
export function PosScreen({
  products,
  initialShift,
  initialReport,
  maxDiscount,
  minAge,
}: {
  products: Product[];
  initialShift: Shift;
  initialReport: Report;
  maxDiscount: string | null;
  minAge: string;
}) {
  const t = useTranslations('pos');
  const tSoon = useTranslations('common.notYetItems');
  const locale = useLocale();

  const [shift, setShift] = useState<Shift>(initialShift);
  const [report, setReport] = useState<Report>(initialReport);
  const [cart, setCart] = useState<Line[]>([]);
  const [scan, setScan] = useState('');
  const [query, setQuery] = useState('');
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]>('CASH');
  const [receiptDiscount, setReceiptDiscount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [mixedCash, setMixedCash] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [receiptPhone, setReceiptPhone] = useState('');
  // Программа лояльности (этап 3 ТЗ): телефон покупателя, баланс и сколько списать.
  const [customerPhone, setCustomerPhone] = useState('');
  const [customer, setCustomer] = useState<{
    phone: string;
    balance: string;
    maxRedeemShare: string;
  } | null>(null);
  const [bonusRedeem, setBonusRedeem] = useState('');
  const [cash, setCash] = useState('0');
  const [cashOp, setCashOp] = useState<{
    type: 'CASH_IN' | 'CASH_OUT';
    amount: string;
    reason: string;
  } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [held, setHeld] = useState<HeldReceipt[]>([]);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<{ key: string; change?: string; bonus?: string } | null>(
    null,
  );
  const [error, setError] = useState<{ key: string; value?: string } | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ id: string; number: string } | null>(null);
  // Возврат без права «Касса → изменение» подтверждает старший кодом (разделы 4.2 и 3.12 ТЗ).
  const [approval, setApproval] = useState<{ phone: string; code: string; issued?: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  const [period, setPeriod] = useState({ from: today, to: today });

  // Очередь офлайн-чеков уходит на сервер, как только появляется связь.
  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      setHeld(readStored<HeldReceipt>(HELD_KEY));
      void flushQueue();
    };
    const offline = () => setOnline(false);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', offline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Отправка отложенных чеков: идентификатор чека делает повтор безопасным. */
  async function flushQueue() {
    const queue = readStored<QueuedSale>(QUEUE_KEY);
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

    writeStored(QUEUE_KEY, left);
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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? products.filter(
          (product) =>
            product.name.toLowerCase().includes(needle) || product.barcode.includes(needle),
        )
      : products;
  }, [products, query]);

  const totals = previewTotals(cart, receiptDiscount);
  const redeemValue = customer ? Number(bonusRedeem || '0') : 0;
  const toPay = Math.round((totals.total - redeemValue) * 100) / 100;
  const change = payment === 'CASH' && cashReceived ? Number(cashReceived) - toPay : null;

  async function findCustomer() {
    setError(null);
    const response = await fetch(`/api/pos/loyalty?phone=${encodeURIComponent(customerPhone)}`);
    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      phone?: string;
      balance?: string;
      maxRedeemShare?: string;
    };
    if (data.status !== 'ok') {
      setCustomer(null);
      setError({ key: data.status ?? 'unknown' });
      return;
    }
    setCustomer({
      phone: data.phone!,
      balance: data.balance!,
      maxRedeemShare: data.maxRedeemShare!,
    });
  }

  function add(product: Product, byPiece = false) {
    setError(null);
    const key = byPiece ? `${product.productId}:piece` : product.productId;
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      // Маркированный товар добавляется сканированием кода: количество = числу кодов.
      if (!existing) {
        return [
          ...current,
          {
            ...product,
            // Поштучно цена — за штуку, количество — число штук.
            price: byPiece ? product.piecePrice! : product.price,
            key,
            byPiece,
            quantity: product.isMarked ? '0' : '1',
            discountPercent: '',
            markingCodes: [],
          },
        ];
      }
      if (product.isMarked) return current;
      return current.map((item) =>
        item.key === key ? { ...item, quantity: String(Number(item.quantity) + 1) } : item,
      );
    });
  }

  function addByBarcode(code: string) {
    const found = products.find((product) => product.barcode === code.trim());
    setScan('');
    if (!found) {
      setError({ key: 'not_found' });
      return;
    }
    add(found);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setCart((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function step(key: string, delta: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.key === key
            ? { ...item, quantity: String(Math.max(0, Number(item.quantity) + delta)) }
            : item,
        )
        .filter((item) => item.key !== key || Number(item.quantity) > 0),
    );
  }

  /** DataMatrix со сканера: код добавляется к позиции, количество растёт на единицу. */
  function addCode(productId: string) {
    const code = (codeDrafts[productId] ?? '').trim();
    if (!code) return;
    setCart((current) =>
      current.map((item) =>
        item.productId === productId && !item.markingCodes.includes(code)
          ? {
              ...item,
              markingCodes: [...item.markingCodes, code],
              quantity: String(item.markingCodes.length + 1),
            }
          : item,
      ),
    );
    setCodeDrafts((current) => ({ ...current, [productId]: '' }));
  }

  function removeCode(productId: string, code: string) {
    setCart((current) =>
      current.map((item) =>
        item.productId === productId
          ? {
              ...item,
              markingCodes: item.markingCodes.filter((value) => value !== code),
              quantity: String(item.markingCodes.length - 1),
            }
          : item,
      ),
    );
  }

  function resetReceipt() {
    setAgeConfirmed(false);
    setCart([]);
    setReceiptDiscount('');
    setCashReceived('');
    setMixedCash('');
    setCustomerPhone('');
    setCustomer(null);
    setBonusRedeem('');
  }

  /** Отложенный чек (раздел 4.2 ТЗ): покупатель отошёл — обслуживаем следующего. */
  function hold() {
    if (cart.length === 0) return;
    const next = [
      ...held,
      { id: crypto.randomUUID(), at: new Date().toISOString(), lines: cart, receiptDiscount },
    ];
    setHeld(next);
    writeStored(HELD_KEY, next);
    resetReceipt();
    setNotice({ key: 'held' });
  }

  function restore(id: string) {
    const receipt = held.find((item) => item.id === id);
    if (!receipt) return;
    const next = held.filter((item) => item.id !== id);
    setHeld(next);
    writeStored(HELD_KEY, next);
    setCart(receipt.lines);
    setReceiptDiscount(receipt.receiptDiscount);
  }

  async function sell() {
    if (cart.length === 0) return;
    setPending(true);
    setError(null);
    setNotice(null);

    const sale: QueuedSale = {
      clientId: crypto.randomUUID(),
      paymentType: payment,
      lines: cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        discountPercent: item.discountPercent || undefined,
        markingCodes: item.isMarked ? item.markingCodes : undefined,
        byPiece: item.byPiece || undefined,
      })),
      ageConfirmed: ageConfirmed || undefined,
      receiptDiscountPercent: receiptDiscount || undefined,
      cashReceived: payment === 'CASH' && cashReceived ? cashReceived : undefined,
      cashAmount: payment === 'MIXED' ? mixedCash || '0' : undefined,
      cardAmount: payment === 'MIXED' ? money(toPay - Number(mixedCash || '0')) : undefined,
      customerPhone: customerPhone.trim() || undefined,
      bonusRedeem: customer && bonusRedeem ? bonusRedeem : undefined,
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
        change?: string;
        limit?: string;
        total?: string;
        hours?: string;
        productId?: string;
        available?: string;
        bonusEarned?: string;
      };
      if (data.status !== 'ok') {
        const product = cart.find((item) => item.productId === data.productId)?.name;
        setError({
          key: data.status ?? 'unknown',
          value: data.limit ?? data.total ?? data.hours ?? data.available ?? product,
        });
        setPending(false);
        return;
      }
      setLastReceipt({ id: data.receiptId!, number: data.number! });
      setNotice({ key: 'sold', change: data.change, bonus: data.bonusEarned });
      resetReceipt();
      await refresh();
    } catch {
      // Связи нет: чек ждёт синхронизации, касса продолжает работать.
      const queue = [...readStored<QueuedSale>(QUEUE_KEY), sale];
      writeStored(QUEUE_KEY, queue);
      setQueued(queue.length);
      setNotice({ key: 'queued' });
      resetReceipt();
    }
    setPending(false);
  }

  async function post(path: string, body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
      available?: string;
    };
    setPending(false);
    if (data.status !== 'ok') {
      setError({ key: data.status ?? data.error ?? 'unknown', value: data.available });
      return false;
    }
    await refresh();
    return true;
  }

  async function refundLast() {
    if (!lastReceipt) return;
    setPending(true);
    setError(null);
    const response = await fetch('/api/pos/refund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        receiptId: lastReceipt.id,
        approverPhone: approval?.phone,
        approverCode: approval?.code,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
    setPending(false);
    if (data.status === 'approval_required') {
      setApproval({ phone: '', code: '' });
      return;
    }
    if (data.status !== 'ok') {
      setError({ key: data.status ?? data.error ?? 'unknown' });
      return;
    }
    setApproval(null);
    setNotice({ key: 'refunded' });
    setLastReceipt(null);
    await refresh();
  }

  async function requestApprovalCode() {
    if (!approval) return;
    setError(null);
    const response = await fetch('/api/pos/refund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'request_code', approverPhone: approval.phone }),
    });
    const data = (await response.json().catch(() => ({}))) as { status?: string; code?: string };
    if (data.status !== 'ok') {
      setError({ key: data.status ?? 'unknown' });
      return;
    }
    // У мока SMS код в ответе, с настоящим провайдером он только в SMS старшему.
    setApproval({ ...approval, issued: data.code ?? '' });
  }

  async function submitCashOp() {
    if (!cashOp) return;
    if (await post('/api/pos/cash', cashOp)) {
      setNotice({ key: cashOp.type === 'CASH_IN' ? 'cashIn' : 'cashOut' });
      setCashOp(null);
    }
  }

  return (
    <Page width="lg">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Badge tone={online ? 'success' : 'warning'} data-testid="pos-online">
            {online ? (
              <Wifi aria-hidden className="size-3.5" />
            ) : (
              <WifiOff aria-hidden className="size-3.5" />
            )}
            {online ? t('online') : t('offline')}
          </Badge>
        }
      />

      <Card data-testid="pos-shift">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span
                className={cn('size-2 rounded-full', shift ? 'bg-success' : 'bg-muted-foreground')}
              />
              {shift ? t('shiftOpen', { number: shift.number }) : t('shiftClosed')}
            </CardTitle>
            {report ? (
              <p
                className="text-muted-foreground mt-1 text-[13px] font-semibold"
                data-testid="pos-report"
              >
                {t('reportLine', {
                  receipts: report.receipts,
                  total: formatMoney(report.total),
                  cash: formatMoney(report.expectedCash),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {shift ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="pos-x-report"
                  onClick={() => setShowReport((value) => !value)}
                >
                  {t('xReport')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="pos-cash-in"
                  onClick={() => setCashOp({ type: 'CASH_IN', amount: '', reason: '' })}
                >
                  {t('cashIn')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="pos-cash-out"
                  onClick={() => setCashOp({ type: 'CASH_OUT', amount: '', reason: '' })}
                >
                  {t('cashOut')}
                </Button>
              </>
            ) : null}
            <Field label={shift ? t('closingCash') : t('cash')}>
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
              onClick={() =>
                void post('/api/pos/shift', {
                  action: shift ? 'close' : 'open',
                  shiftId: shift?.id,
                  cash,
                }).then((ok) => ok && shift && setShowReport(false))
              }
            >
              {shift ? t('closeShift') : t('openShift')}
            </Button>
          </div>
        </div>

        {cashOp ? (
          <div className="border-border mt-4 grid grid-cols-1 items-end gap-3 rounded-2xl border-[1.5px] border-dashed p-3 sm:grid-cols-[8rem_1fr_auto]">
            <Field label={cashOp.type === 'CASH_IN' ? t('cashInAmount') : t('cashOutAmount')}>
              <Input
                inputMode="decimal"
                value={cashOp.amount}
                data-testid="pos-cash-op-amount"
                onChange={(event) => setCashOp({ ...cashOp, amount: event.target.value })}
              />
            </Field>
            <Field label={t('cashReason')}>
              <Input
                value={cashOp.reason}
                data-testid="pos-cash-op-reason"
                onChange={(event) => setCashOp({ ...cashOp, reason: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                disabled={pending}
                data-testid="pos-cash-op-submit"
                onClick={() => void submitCashOp()}
              >
                {t('save')}
              </Button>
              <Button variant="ghost" onClick={() => setCashOp(null)}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : null}

        {showReport && report ? <ReportPanel report={report} /> : null}

        <div
          className="border-border mt-4 flex flex-wrap items-end gap-2 border-t pt-4"
          data-testid="pos-period"
        >
          <p className="w-full text-sm font-medium">{t('periodTitle')}</p>
          <Field label={t('periodFrom')}>
            <Input
              type="date"
              className="w-40"
              value={period.from}
              data-testid="pos-period-from"
              onChange={(event) => setPeriod({ ...period, from: event.target.value })}
            />
          </Field>
          <Field label={t('periodTo')}>
            <Input
              type="date"
              className="w-40"
              value={period.to}
              data-testid="pos-period-to"
              onChange={(event) => setPeriod({ ...period, to: event.target.value })}
            />
          </Field>
          <a
            href={`/api/pos/report/xlsx?from=${period.from}&to=${period.to}&locale=${locale}`}
            className={buttonVariants({ variant: 'outline' })}
            data-testid="pos-period-xlsx"
          >
            {t('downloadSales')}
          </a>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_24rem]">
        <Card>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('scan')}>
              <div className="relative">
                <ScanBarcode
                  aria-hidden
                  className="text-muted-foreground absolute top-3.5 left-3 size-4"
                />
                <Input
                  className="pl-9"
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
              </div>
              <CameraScanButton onCode={addByBarcode} />
            </Field>
            <Field label={t('search')}>
              <div className="relative">
                <Search
                  aria-hidden
                  className="text-muted-foreground absolute top-3.5 left-3 size-4"
                />
                <Input
                  className="pl-9"
                  value={query}
                  data-testid="pos-search"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </Field>
            {/* Макет D08: весовой товар с весов. Нужен драйвер весов (REMAINING.md). */}
            <NotYetButton className="sm:col-span-2">{tSoon('scales')}</NotYetButton>
          </div>

          <ul
            className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
            data-testid="pos-tiles"
          >
            {visible.map((product) => (
              <li key={product.productId}>
                <button
                  type="button"
                  className="border-border hover:border-primary hover:bg-primary-soft/40 flex h-full w-full flex-col justify-between gap-2 rounded-2xl border p-3 text-left text-sm transition-colors active:scale-[0.98]"
                  data-testid="pos-tile"
                  onClick={() => add(product)}
                >
                  <span className="line-clamp-2 font-medium break-words">{product.name}</span>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold tabular-nums">
                      {formatMoney(product.price)} ₸
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {product.stock}
                    </span>
                  </span>
                </button>
                {product.piecesPerPack && product.piecePrice && !product.isMarked ? (
                  <button
                    type="button"
                    className="border-border hover:border-primary mt-1 flex w-full items-baseline justify-between gap-2 rounded-2xl border-[1.5px] border-dashed px-3 py-1.5 text-left text-xs"
                    data-testid="pos-tile-piece"
                    onClick={() => add(product, true)}
                  >
                    <span>{t('byPiece')}</span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(product.piecePrice)} ₸
                    </span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {visible.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">{t('noProducts')}</p>
          ) : null}

          <div className="mt-4">
            <Field label={t('product')}>
              <select
                className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
                data-testid="pos-product"
                defaultValue=""
                onChange={(event) => {
                  const product = products.find((item) => item.productId === event.target.value);
                  if (product) add(product);
                  event.target.value = '';
                }}
              >
                <option value="">—</option>
                {products.map((product) => (
                  <option key={product.productId} value={product.productId}>
                    {product.name} · {formatMoney(product.price)} ₸
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>

        <Card className="flex flex-col lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-[15px]">{t('sale')}</CardTitle>
            {cart.length > 0 ? (
              <Button variant="ghost" size="sm" data-testid="pos-clear" onClick={resetReceipt}>
                <Trash2 aria-hidden />
                {t('clear')}
              </Button>
            ) : null}
          </div>
          {maxDiscount ? <CardHint>{t('discountLimit', { limit: maxDiscount })}</CardHint> : null}

          {cart.length === 0 ? (
            <p className="text-muted-foreground mt-6 mb-4 text-center text-sm">{t('emptyCart')}</p>
          ) : (
            <ul className="divide-border mt-3 divide-y text-sm" data-testid="pos-cart">
              {cart.map((item) => (
                <li key={item.key} className="space-y-1.5 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 break-words">
                      {item.name}
                      {item.isExcise ? (
                        <Badge tone="warning" className="ml-1.5">
                          {t('exciseBadge')}
                        </Badge>
                      ) : null}
                      {item.byPiece ? (
                        <Badge tone="info" className="ml-1.5" data-testid="pos-line-piece">
                          {t('byPieceBadge', { pieces: item.piecesPerPack ?? 0 })}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="tabular-nums">{formatMoney(item.price)} ₸</span>
                  </div>
                  {item.isMarked ? (
                    <div className="space-y-1" data-testid="pos-marking">
                      <div className="flex gap-2">
                        <Input
                          className="h-8 px-2 text-[13px] font-bold tabular-nums"
                          placeholder={t('markingPlaceholder')}
                          aria-label={t('markingPlaceholder')}
                          value={codeDrafts[item.productId] ?? ''}
                          data-testid="pos-marking-input"
                          onChange={(event) =>
                            setCodeDrafts((current) => ({
                              ...current,
                              [item.productId]: event.target.value,
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            addCode(item.productId);
                          }}
                        />
                        <Button variant="outline" size="sm" onClick={() => addCode(item.productId)}>
                          {t('markingAdd')}
                        </Button>
                      </div>
                      <ul className="flex flex-wrap gap-1">
                        {item.markingCodes.map((code) => (
                          <li
                            key={code}
                            className="bg-muted flex items-center gap-1 rounded px-1.5 text-[10px] tabular-nums"
                          >
                            …{code.slice(-8)}
                            <button
                              type="button"
                              aria-label={t('markingRemove')}
                              onClick={() => removeCode(item.productId, code)}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label={t('less')}
                      disabled={item.isMarked}
                      onClick={() => step(item.key, -1)}
                    >
                      <Minus aria-hidden />
                    </Button>
                    <Input
                      className="h-8 w-16 px-2 text-center"
                      inputMode="decimal"
                      value={item.quantity}
                      readOnly={item.isMarked}
                      aria-label={t('quantity')}
                      onChange={(event) => updateLine(item.key, { quantity: event.target.value })}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label={t('more')}
                      disabled={item.isMarked}
                      onClick={() => step(item.key, 1)}
                    >
                      <Plus aria-hidden />
                    </Button>
                    <Input
                      className="ml-auto h-8 w-20 px-2 text-right"
                      inputMode="decimal"
                      placeholder={t('discountShort')}
                      value={item.discountPercent}
                      aria-label={t('lineDiscount')}
                      data-testid="pos-line-discount"
                      onChange={(event) =>
                        updateLine(item.key, { discountPercent: event.target.value })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('removeLine')}
                      data-testid="pos-remove-line"
                      onClick={() => step(item.key, -Number(item.quantity))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label={t('receiptDiscount')}>
              <Input
                inputMode="decimal"
                value={receiptDiscount}
                placeholder="0"
                data-testid="pos-receipt-discount"
                onChange={(event) => setReceiptDiscount(event.target.value)}
              />
            </Field>
            {payment === 'CASH' ? (
              <Field label={t('cashReceived')}>
                <Input
                  inputMode="decimal"
                  value={cashReceived}
                  data-testid="pos-cash-received"
                  onChange={(event) => setCashReceived(event.target.value)}
                />
              </Field>
            ) : payment === 'MIXED' ? (
              <Field label={t('mixedCash')}>
                <Input
                  inputMode="decimal"
                  value={mixedCash}
                  data-testid="pos-mixed-cash"
                  onChange={(event) => setMixedCash(event.target.value)}
                />
              </Field>
            ) : null}
          </div>

          <div
            className="border-border mt-3 rounded-2xl border-[1.5px] border-dashed p-3"
            data-testid="pos-loyalty"
          >
            <p className="text-muted-foreground text-xs font-semibold">{t('loyalty.title')}</p>
            <div className="mt-1.5 flex gap-2">
              <Input
                className="h-9 min-w-0 flex-1"
                inputMode="tel"
                placeholder={t('loyalty.phone')}
                aria-label={t('loyalty.phone')}
                value={customerPhone}
                data-testid="pos-customer-phone"
                onChange={(event) => {
                  setCustomerPhone(event.target.value);
                  setCustomer(null);
                  setBonusRedeem('');
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!customerPhone.trim()}
                data-testid="pos-customer-find"
                onClick={() => void findCustomer()}
              >
                {t('loyalty.find')}
              </Button>
            </div>
            {customer ? (
              <div className="mt-2 flex flex-wrap items-end gap-2 text-sm">
                <p className="w-full" data-testid="pos-customer-balance">
                  {t('loyalty.balance', {
                    phone: customer.phone,
                    balance: formatMoney(customer.balance),
                  })}
                </p>
                <Field label={t('loyalty.redeem', { share: customer.maxRedeemShare })}>
                  <Input
                    className="h-9 w-28"
                    inputMode="decimal"
                    value={bonusRedeem}
                    placeholder="0"
                    data-testid="pos-bonus-redeem"
                    onChange={(event) => setBonusRedeem(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </div>

          {cart.some((item) => item.isExcise) ? (
            <label className="bg-warning-soft text-warning mt-3 flex items-center gap-2 rounded-2xl px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={ageConfirmed}
                data-testid="pos-age-confirmed"
                onChange={(event) => setAgeConfirmed(event.target.checked)}
              />
              {t('ageConfirm', { age: minAge })}
            </label>
          ) : null}

          <div
            className="mt-3 grid grid-cols-4 gap-1.5"
            role="radiogroup"
            aria-label={t('payment')}
          >
            {PAYMENTS.map((type) => {
              const Icon = PAYMENT_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={payment === type}
                  data-testid={`pos-pay-${type}`}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-2xl border px-1 py-2 text-[11px] transition-colors',
                    payment === type
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border hover:bg-muted',
                  )}
                  onClick={() => setPayment(type)}
                >
                  <Icon aria-hidden className="size-4" />
                  {t(`payments.${type}`)}
                </button>
              );
            })}
          </div>
          <select
            hidden
            data-testid="pos-payment"
            value={payment}
            onChange={(event) => setPayment(event.target.value as (typeof PAYMENTS)[number])}
          >
            {PAYMENTS.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <div className="border-border mt-4 space-y-1 border-t pt-3 text-sm">
            {totals.gross !== totals.total ? (
              <p className="text-muted-foreground flex justify-between">
                <span>{t('discount')}</span>
                <span className="tabular-nums">
                  {formatMoney(money(-(totals.gross - totals.total)))} ₸
                </span>
              </p>
            ) : null}
            {redeemValue > 0 ? (
              <p
                className="text-muted-foreground flex justify-between"
                data-testid="pos-bonus-line"
              >
                <span>{t('loyalty.paidByBonus')}</span>
                <span className="tabular-nums">{formatMoney(money(-redeemValue))} ₸</span>
              </p>
            ) : null}
            {payment === 'MIXED' && cart.length > 0 ? (
              <p
                className="text-muted-foreground flex justify-between"
                data-testid="pos-mixed-card"
              >
                <span>{t('mixedCard')}</span>
                <span className="tabular-nums">
                  {formatMoney(money(toPay - Number(mixedCash || '0')))} ₸
                </span>
              </p>
            ) : null}
            {change !== null && change >= 0 ? (
              <p className="flex justify-between font-medium" data-testid="pos-change">
                <span>{t('change')}</span>
                <span className="tabular-nums">{formatMoney(money(change))} ₸</span>
              </p>
            ) : null}
            <p className="flex items-baseline justify-between">
              <span>{t('total')}</span>
              <span className="text-2xl font-semibold tabular-nums" data-testid="pos-total">
                {formatMoney(money(toPay))} ₸
              </span>
            </p>
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              disabled={pending || cart.length === 0}
              data-testid="pos-sell"
              onClick={() => void sell()}
            >
              {t('sell')}
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={cart.length === 0}
              aria-label={t('hold')}
              title={t('hold')}
              data-testid="pos-hold"
              onClick={hold}
            >
              <PauseCircle aria-hidden />
            </Button>
          </div>

          {held.length > 0 ? (
            <div className="mt-3">
              <p className="text-muted-foreground text-xs font-semibold">{t('heldTitle')}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="pos-held">
                {held.map((receipt) => (
                  <li key={receipt.id}>
                    <Button variant="secondary" size="sm" onClick={() => restore(receipt.id)}>
                      {t('heldItem', {
                        time: new Date(receipt.at).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }),
                        count: receipt.lines.length,
                      })}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {lastReceipt ? (
            <div className="mt-3 flex flex-wrap gap-2" data-testid="pos-e-receipt">
              <Input
                className="h-9 min-w-0 flex-1"
                inputMode="tel"
                placeholder={t('receiptPhone')}
                aria-label={t('receiptPhone')}
                value={receiptPhone}
                data-testid="pos-receipt-phone"
                onChange={(event) => setReceiptPhone(event.target.value)}
              />
              {(['sms', 'whatsapp'] as const).map((channel) => (
                <Button
                  key={channel}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  data-testid={`pos-receipt-${channel}`}
                  onClick={() =>
                    void post(`/api/pos/receipt/${lastReceipt.id}/send`, {
                      phone: receiptPhone,
                      channel,
                    }).then((ok) => {
                      if (ok) setNotice({ key: 'receiptSent' });
                    })
                  }
                >
                  {t(`receiptChannels.${channel}`)}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {lastReceipt ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                data-testid="pos-refund"
                onClick={() => void refundLast()}
              >
                {t('refund', { number: lastReceipt.number })}
              </Button>
            ) : null}
            {lastReceipt ? (
              <a
                href={`/${locale}/pos/receipt/${lastReceipt.id}`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="pos-print"
              >
                {t('printReceipt')}
              </a>
            ) : null}
            {approval ? (
              <div
                className="border-border flex w-full flex-wrap items-end gap-2 rounded-2xl border-[1.5px] border-dashed p-3"
                data-testid="pos-approval"
              >
                <p className="w-full text-sm">{t('approvalTitle')}</p>
                <Input
                  className="h-9 w-44"
                  inputMode="tel"
                  placeholder={t('approvalPhone')}
                  value={approval.phone}
                  data-testid="pos-approval-phone"
                  onChange={(event) => setApproval({ ...approval, phone: event.target.value })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="pos-approval-request"
                  onClick={() => void requestApprovalCode()}
                >
                  {t('approvalRequest')}
                </Button>
                <Input
                  className="h-9 w-28"
                  inputMode="numeric"
                  placeholder={t('approvalCode')}
                  value={approval.code}
                  data-testid="pos-approval-code"
                  onChange={(event) => setApproval({ ...approval, code: event.target.value })}
                />
                <Button
                  size="sm"
                  disabled={pending}
                  data-testid="pos-approval-confirm"
                  onClick={() => void refundLast()}
                >
                  {t('approvalConfirm')}
                </Button>
                {approval.issued !== undefined ? (
                  <p
                    className="text-muted-foreground w-full text-xs"
                    data-testid="pos-approval-issued"
                  >
                    {approval.issued
                      ? t('approvalIssued', { code: approval.issued })
                      : t('approvalSmsSent')}
                  </p>
                ) : null}
              </div>
            ) : null}
            {queued > 0 ? (
              <span className="text-muted-foreground text-sm font-medium" data-testid="pos-queued">
                {t('queued', { count: queued })}
              </span>
            ) : null}
          </div>

          {notice ? (
            <p className="text-success mt-2 text-sm" data-testid="pos-notice">
              {t(`notices.${notice.key}` as 'notices.sold')}
              {notice.change && notice.change !== '0.00'
                ? ` ${t('changeGiven', { change: formatMoney(notice.change) })}`
                : ''}
              {notice.bonus && notice.bonus !== '0.00'
                ? ` ${t('loyalty.earned', { bonus: formatMoney(notice.bonus) })}`
                : ''}
            </p>
          ) : null}
          {error ? (
            <p className="text-danger mt-2 text-sm" role="alert" data-testid="pos-error">
              {t(`errors.${error.key}` as 'errors.unknown', { value: error.value ?? '' })}
            </p>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}

/** X-отчёт открытой смены: итоги, наличные в ящике, кассиры и товары. */
function ReportPanel({ report }: { report: NonNullable<Report> }) {
  const t = useTranslations('pos.report');
  const locale = useLocale();
  const rows: [string, string][] = [
    [t('total'), `${formatMoney(report.total)} ₸`],
    [t('receipts'), `${report.receipts} / ${report.refunds}`],
    [t('averageCheck'), `${formatMoney(report.averageCheck)} ₸`],
    [t('discounts'), `${formatMoney(report.discounts)} ₸`],
    [t('margin'), `${formatMoney(report.margin)} ₸`],
    [t('cash'), `${formatMoney(report.byPayment.CASH)} ₸`],
    [t('card'), `${formatMoney(report.byPayment.CARD)} ₸`],
    [t('qr'), `${formatMoney(report.byPayment.QR)} ₸`],
    [t('bonus'), `${formatMoney(report.byPayment.BONUS)} ₸`],
    [t('bonusEarned'), `${formatMoney(report.bonusEarned)} ₸`],
    [t('opening'), `${formatMoney(report.openingCash)} ₸`],
    [t('cashIn'), `${formatMoney(report.cashIn)} ₸`],
    [t('cashOut'), `${formatMoney(report.cashOut)} ₸`],
    [t('expectedCash'), `${formatMoney(report.expectedCash)} ₸`],
  ];
  return (
    <div
      className="border-border mt-4 grid grid-cols-1 gap-4 border-t pt-4 md:grid-cols-3"
      data-testid="pos-x-report-panel"
    >
      <dl className="space-y-1 text-sm md:col-span-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="text-sm">
        <p className="font-medium">{t('byCashier')}</p>
        <ul className="mt-1 space-y-1">
          {report.byCashier.map((row) => (
            <li key={row.name} className="flex justify-between gap-3">
              <span className="truncate">{row.name}</span>
              <span className="tabular-nums">{formatMoney(row.total)} ₸</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="text-sm">
        <p className="font-medium">{t('topProducts')}</p>
        <ul className="mt-1 space-y-1">
          {report.topProducts.map((row) => (
            <li key={row.nameRu} className="flex justify-between gap-3">
              <span className="truncate">{locale === 'kk' ? row.nameKk : row.nameRu}</span>
              <span className="tabular-nums">{formatMoney(row.total)} ₸</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
