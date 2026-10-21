'use client';

import * as React from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Сегмент-контрол макета: мягкая подложка, активный пункт — белая «пилюля» с тенью. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: {
  options: { value: T; label: string; testId?: string; activeClass?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('bg-muted flex rounded-full p-[3px]', className)} role="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-1 items-center justify-center rounded-full px-4 text-[13px] font-bold whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-[34px]' : 'h-[38px]',
              active
                ? 'bg-card text-foreground shadow-[0_1px_4px_rgb(0_0_0/0.08)]'
                : cn('text-muted-foreground hover:text-foreground', option.activeClass),
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Чип-фильтр: тёмный, когда включён. Внутри настоящий чекбокс поверх чипа (прозрачный),
 * поэтому фильтр работает с клавиатуры и в тестах как обычный флажок.
 */
export function ChipToggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        'relative inline-flex h-9 shrink-0 cursor-pointer items-center rounded-full px-[15px] text-[13px] font-bold whitespace-nowrap transition-colors',
        checked ? 'bg-foreground text-background' : 'border-border bg-card hover:bg-muted border',
      )}
    >
      <input
        type="checkbox"
        className="absolute inset-0 cursor-pointer opacity-0"
        checked={checked}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/** Кнопка-чип без флажка: «Все», быстрые ответы чата. */
export function Chip({
  active = false,
  className,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-full px-[15px] text-[13px] font-bold whitespace-nowrap transition-colors',
        active ? 'bg-foreground text-background' : 'border-border bg-card hover:bg-muted border',
        className,
      )}
      {...props}
    />
  );
}

/** Выпадающий фильтр-«пилюля» макета D01: «Категория ⌄», «Поставщик ⌄». */
export function PillSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <select
        className="border-border bg-card hover:bg-muted h-[38px] max-w-52 cursor-pointer appearance-none truncate rounded-full border pr-9 pl-3.5 text-[13px] font-bold"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2"
        strokeWidth={2.4}
      />
    </span>
  );
}

/**
 * Степпер количества макета: «− 2 кор. +». Число редактируется вручную (поле ввода),
 * кнопки меняют его на шаг — кратность упаковки.
 */
export function Stepper({
  value,
  onDecrease,
  onIncrease,
  inputProps,
  size = 'sm',
  suffix,
  disabled = false,
}: {
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  inputProps?: React.ComponentProps<'input'>;
  size?: 'sm' | 'md';
  suffix?: string;
  disabled?: boolean;
}) {
  const big = size === 'md';
  return (
    <div
      className={cn(
        'bg-muted flex shrink-0 items-center rounded-full px-1',
        big ? 'h-11' : 'h-[34px]',
        disabled && 'opacity-50',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onDecrease}
        aria-label="−"
        className={cn(
          'bg-card grid place-items-center rounded-full',
          big ? 'size-9' : 'size-[26px]',
        )}
      >
        <Minus className={big ? 'size-[18px]' : 'size-3.5'} strokeWidth={2} />
      </button>
      <span className="flex items-baseline justify-center">
        <input
          inputMode="decimal"
          disabled={disabled}
          value={value}
          className={cn(
            'bg-transparent text-center font-extrabold tabular-nums outline-none',
            big ? 'w-[52px] text-[15px]' : 'w-[42px] text-[13px]',
          )}
          {...inputProps}
        />
        {suffix ? (
          <span className={cn('-ml-1 pr-1 font-extrabold', big ? 'text-[15px]' : 'text-[13px]')}>
            {suffix}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onIncrease}
        aria-label="+"
        className={cn(
          'bg-primary grid place-items-center rounded-full',
          big ? 'size-9' : 'size-[26px]',
        )}
      >
        <Plus className={cn('text-white', big ? 'size-[18px]' : 'size-3.5')} strokeWidth={2.6} />
      </button>
    </div>
  );
}

/** Полоса прогресса макета: трек #E6E2DC, заливка — зелёная, оранжевая или тёмная. */
export function Progress({
  value,
  tone = 'success',
  className,
  height = 5,
}: {
  value: number;
  tone?: 'success' | 'primary' | 'dark' | 'danger';
  className?: string;
  height?: 5 | 6;
}) {
  const fills = {
    success: 'bg-success',
    primary: 'bg-primary',
    dark: 'bg-foreground',
    danger: 'bg-danger',
  };
  return (
    <div
      className={cn(
        'bg-track overflow-hidden rounded-full',
        height === 6 ? 'h-1.5' : 'h-[5px]',
        className,
      )}
    >
      <div
        className={cn('h-full rounded-full', fills[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/** Квадратный аватар с инициалами: поставщик, магазин, сотрудник. */
export function Avatar({
  name,
  tone = 'primary',
  size = 32,
  className,
}: {
  name: string;
  tone?: 'primary' | 'dark' | 'beige';
  size?: 32 | 34 | 36 | 40 | 52;
  className?: string;
}) {
  const tones = { primary: 'bg-primary', dark: 'bg-foreground', beige: 'bg-[#b9a58f]' };
  const sizes = {
    32: 'size-8 rounded-[11px] text-xs',
    34: 'size-[34px] rounded-xl text-xs',
    36: 'size-9 rounded-xl text-[13px]',
    40: 'size-10 rounded-[14px] text-sm',
    52: 'size-[52px] rounded-[18px] text-xl',
  };
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center font-black text-white',
        tones[tone],
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Инициалы: «ТОО «Дала Сут» (тест)» → «ДС». Организационная форма и пометки не учитываются. */
export function initials(name: string) {
  const words = name
    .replace(/[«»"()]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !/^(ТОО|ИП|АО|тест)$/i.test(word));
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('') || name.slice(0, 1)
  ).toUpperCase();
}
