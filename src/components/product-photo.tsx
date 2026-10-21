import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Цвет заглушки выводится из названия: одинаковый товар — одинаковая плитка. */
function hueFrom(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/**
 * Фото товара. Загрузки файлов в демо нет: поставщик указывает ссылку в каталоге,
 * без ссылки показывается цветная плитка с первой буквой названия.
 */
export function ProductPhoto({
  src,
  name,
  className,
  size = 'md',
}: {
  src: string | null;
  name: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
}) {
  // Плитки макета: 40–54 px с рамкой в списках, «hero» — фото на свайп-карточке без рамки.
  const boxes = {
    sm: 'size-11 rounded-xl border',
    md: 'size-[54px] rounded-[14px] border',
    lg: 'aspect-[4/3] w-full rounded-[20px]',
    hero: 'h-full w-full',
  };
  const shared = cn('border-border overflow-hidden', boxes[size], className);

  if (src) {
    return (
      <div
        className={cn(shared, 'bg-card relative', size === 'hero' && 'bg-transparent')}
        data-testid="product-photo"
      >
        <Image
          src={src}
          alt={name}
          fill
          sizes="(max-width: 640px) 100vw, 320px"
          className={size === 'hero' ? 'object-contain p-[8%]' : 'object-contain p-[10%]'}
        />
      </div>
    );
  }

  const hue = hueFrom(name);
  return (
    <div
      className={cn(shared, 'grid place-items-center font-semibold')}
      style={{
        background: `oklch(0.93 0.05 ${hue})`,
        color: `oklch(0.42 0.11 ${hue})`,
      }}
      aria-hidden
      data-testid="product-photo-placeholder"
    >
      <span
        className={
          size === 'lg' || size === 'hero'
            ? 'text-6xl font-black'
            : size === 'md'
              ? 'text-xl'
              : 'text-sm'
        }
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    </div>
  );
}
