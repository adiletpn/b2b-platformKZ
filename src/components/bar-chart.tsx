/**
 * Столбчатый график в SVG своим кодом, без библиотек (этап 3 ТЗ, аналитика).
 * Две серии рядом: основная (выручка) и вторая (прибыль). Цвета — токены темы.
 */
export type BarDatum = { label: string; value: number; second?: number };

export function BarChart({
  data,
  title,
  seriesLabels,
  testId,
}: {
  data: BarDatum[];
  title: string;
  seriesLabels: [string, string?];
  testId?: string;
}) {
  const width = 640;
  const height = 200;
  const top = 12;
  const bottom = 28;
  const max = Math.max(1, ...data.flatMap((row) => [row.value, row.second ?? 0]));
  const slot = data.length > 0 ? width / data.length : width;
  const bar = Math.max(2, Math.min(18, slot / 3));
  const scale = (value: number) => (Math.max(0, value) / max) * (height - top - bottom);
  // Подписи по оси — не чаще, чем помещается: примерно каждая седьмая при 30 днях.
  const every = Math.max(1, Math.ceil(data.length / 8));

  return (
    <figure className="w-full" data-testid={testId}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        className="h-auto w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={0}
          x2={width}
          y1={height - bottom}
          y2={height - bottom}
          className="stroke-border"
        />
        {data.map((row, index) => {
          const x = index * slot + slot / 2;
          const first = scale(row.value);
          const second = scale(row.second ?? 0);
          return (
            <g key={row.label}>
              <rect
                x={x - bar - 1}
                y={height - bottom - first}
                width={bar}
                height={first}
                rx={2}
                className="fill-primary"
              >
                <title>{`${row.label}: ${row.value.toFixed(2)}`}</title>
              </rect>
              {row.second !== undefined ? (
                <rect
                  x={x + 1}
                  y={height - bottom - second}
                  width={bar}
                  height={second}
                  rx={2}
                  className="fill-success"
                >
                  <title>{`${row.label}: ${row.second.toFixed(2)}`}</title>
                </rect>
              ) : null}
              {index % every === 0 ? (
                <text
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {row.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="text-muted-foreground mt-1 flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-primary size-2.5 rounded-sm" />
          {seriesLabels[0]}
        </span>
        {seriesLabels[1] ? (
          <span className="flex items-center gap-1.5">
            <span className="bg-success size-2.5 rounded-sm" />
            {seriesLabels[1]}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
