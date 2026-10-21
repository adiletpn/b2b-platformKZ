'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Combine, Search, Tags } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { BrandRow, MergeConflicts, ProductRow } from '@/lib/admin/products';

function Header({ icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <IconBadge icon={icon} />
      <div>
        <CardTitle>{title}</CardTitle>
        <CardHint>{hint}</CardHint>
      </div>
    </div>
  );
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as Record<string, unknown> & { status?: string };
}

/**
 * Объединение дублей единого справочника (раздел 3.13 ТЗ): администратор выбирает главный
 * товар и дубль, видит, что мешает объединению, и переносит все ссылки одной транзакцией.
 */
export function ProductMergePanel() {
  const t = useTranslations('admin.merge');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductRow[] | null>(null);
  const [main, setMain] = useState<ProductRow | null>(null);
  const [duplicate, setDuplicate] = useState<ProductRow | null>(null);
  const [conflicts, setConflicts] = useState<MergeConflicts | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const name = (row: ProductRow) => (locale === 'kk' ? row.nameKk : row.nameRu);

  async function search() {
    const response = await fetch(`/api/admin/products?q=${encodeURIComponent(query)}`);
    if (response.ok) setResults(((await response.json()) as { products: ProductRow[] }).products);
  }

  function pick(role: 'main' | 'duplicate', row: ProductRow) {
    setConflicts(null);
    setMessage(null);
    if (role === 'main') setMain(row);
    else setDuplicate(row);
  }

  async function check() {
    if (!main || !duplicate) return;
    const data = await postJson('/api/admin/products', {
      action: 'preview',
      mainId: main.id,
      duplicateId: duplicate.id,
    });
    if (data.status !== 'ok') {
      setMessage(t(`errors.${data.status ?? 'unknown'}` as 'errors.unknown'));
      return;
    }
    setConflicts(data.conflicts as MergeConflicts);
  }

  async function merge() {
    if (!main || !duplicate) return;
    setPending(true);
    const data = await postJson('/api/admin/products', {
      action: 'merge',
      mainId: main.id,
      duplicateId: duplicate.id,
    });
    setPending(false);
    if (data.status === 'conflict') {
      setConflicts(data.conflicts as MergeConflicts);
      return;
    }
    if (data.status !== 'ok') {
      setMessage(t(`errors.${data.status ?? 'unknown'}` as 'errors.unknown'));
      return;
    }
    setMessage(t('done', { barcode: duplicate.barcode }));
    setDuplicate(null);
    setConflicts(null);
    setResults((current) => current?.filter((row) => row.id !== duplicate.id) ?? null);
  }

  const blocked =
    conflicts !== null &&
    conflicts.offers.length + conflicts.balances.length + conflicts.prices.length > 0;

  return (
    <Card data-testid="admin-merge">
      <Header icon={Combine} title={t('title')} hint={t('hint')} />
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Input
          value={query}
          placeholder={t('search')}
          data-testid="merge-search"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="outline" aria-label={t('find')} data-testid="merge-find">
          <Search aria-hidden />
        </Button>
      </form>

      {results && results.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('notFound')}</p>
      ) : null}
      <ul className="divide-border mt-2 divide-y text-sm" data-testid="merge-results">
        {(results ?? []).map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-2 py-2"
            data-testid="merge-result-row"
          >
            <span className="min-w-0 flex-1 break-words">
              {name(row)}
              <span className="text-muted-foreground block font-mono text-xs">
                {row.barcode} · {t('offers', { count: row.offers })}
              </span>
            </span>
            <Button
              variant={main?.id === row.id ? 'default' : 'outline'}
              size="sm"
              data-testid="merge-pick-main"
              onClick={() => pick('main', row)}
            >
              {t('pickMain')}
            </Button>
            <Button
              variant={duplicate?.id === row.id ? 'danger' : 'outline'}
              size="sm"
              data-testid="merge-pick-duplicate"
              onClick={() => pick('duplicate', row)}
            >
              {t('pickDuplicate')}
            </Button>
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div className="border-border rounded-2xl border p-3">
          <dt className="text-muted-foreground text-xs">{t('main')}</dt>
          <dd className="break-words" data-testid="merge-main">
            {main ? `${name(main)} · ${main.barcode}` : '—'}
          </dd>
        </div>
        <div className="border-border rounded-2xl border p-3">
          <dt className="text-muted-foreground text-xs">{t('duplicate')}</dt>
          <dd className="break-words" data-testid="merge-duplicate">
            {duplicate ? `${name(duplicate)} · ${duplicate.barcode}` : '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!main || !duplicate}
          data-testid="merge-check"
          onClick={() => void check()}
        >
          {t('check')}
        </Button>
        <Button
          disabled={!main || !duplicate || pending || conflicts === null || blocked}
          data-testid="merge-submit"
          onClick={() => void merge()}
        >
          {t('merge')}
        </Button>
      </div>

      {conflicts && !blocked ? (
        <p className="text-success mt-2 text-sm" data-testid="merge-ready">
          {t('ready')}
        </p>
      ) : null}
      {blocked ? (
        <div
          className="bg-danger-soft text-danger mt-3 space-y-1 rounded-2xl p-3 text-sm"
          role="alert"
          data-testid="merge-conflicts"
        >
          <p className="font-medium">{t('conflictsTitle')}</p>
          {(['offers', 'balances', 'prices'] as const).map((kind) =>
            conflicts![kind].length > 0 ? (
              <p key={kind} data-testid={`merge-conflict-${kind}`}>
                {t(`conflicts.${kind}`)}: {conflicts![kind].join('; ')}
              </p>
            ) : null,
          )}
        </div>
      ) : null}
      {message ? (
        <p className="mt-2 text-sm" role="status" data-testid="merge-message">
          {message}
        </p>
      ) : null}
    </Card>
  );
}

/** Справочник брендов (раздел 3.13 ТЗ): список с числом товаров и переименование. */
export function BrandsPanel({ initial }: { initial: BrandRow[] }) {
  const t = useTranslations('admin.brands');
  const [brands, setBrands] = useState<BrandRow[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch('/api/admin/brands');
    if (response.ok) setBrands(((await response.json()) as { brands: BrandRow[] }).brands);
  }

  async function rename(from: string) {
    const data = await postJson('/api/admin/brands', { from, to: drafts[from] ?? '' });
    if (data.status !== 'ok') {
      setMessage(t(`errors.${data.status ?? 'unknown'}` as 'errors.unknown'));
      return;
    }
    setMessage(t('renamed', { count: Number(data.updated ?? 0) }));
    setDrafts((current) => ({ ...current, [from]: '' }));
    await load();
  }

  return (
    <Card data-testid="admin-brands">
      <Header icon={Tags} title={t('title')} hint={t('hint')} />
      {brands.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('empty')}</p>
      ) : null}
      <ul className="divide-border mt-2 max-h-96 divide-y overflow-y-auto text-sm">
        {brands.map((row) => (
          <li
            key={row.brand}
            className="flex flex-wrap items-center gap-2 py-2"
            data-testid="brand-row"
          >
            <span className="min-w-0 flex-1 break-words">
              {row.brand} <Badge>{t('products', { count: row.products })}</Badge>
            </span>
            <Input
              className="h-9 w-44"
              placeholder={t('newName')}
              aria-label={t('newName')}
              value={drafts[row.brand] ?? ''}
              data-testid="brand-rename-input"
              onChange={(event) => setDrafts({ ...drafts, [row.brand]: event.target.value })}
            />
            <Button
              variant="outline"
              size="sm"
              data-testid="brand-rename"
              onClick={() => void rename(row.brand)}
            >
              {t('rename')}
            </Button>
          </li>
        ))}
      </ul>
      {message ? (
        <p className="mt-2 text-sm" role="status" data-testid="brands-message">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
