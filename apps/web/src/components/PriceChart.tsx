// Price over time as a step line (a price holds until it changes). Single series, so no legend:
// the card title names it. Crosshair + tooltip on hover/focus, arrow keys move between points;
// the price history table below the chart is the non-visual view of the same data.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDateTime, formatDiffManYen, formatManYen, formatMillions, formatMonthDay, formatPercent, formatTime } from '@gsb/shared';

export interface PricePoint {
  at: number;
  price: number;
}

const W = 640;
const H = 240;
const M = { l: 52, r: 64, t: 16, b: 28 };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

export function PriceChart({ points, now, tz }: { points: PricePoint[]; now: number; tz: string }) {
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const g = useMemo(() => {
    if (points.length === 0) return null;
    const x0 = points[0]!.at;
    const x1 = Math.max(now, points[points.length - 1]!.at + 60_000);
    const prices = points.map((p) => p.price);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    const pad = (hi - lo || hi * 0.02) * 0.15;
    lo -= pad;
    hi += pad;
    const sx = (t: number) => M.l + ((t - x0) / (x1 - x0)) * (W - M.l - M.r);
    const sy = (v: number) => M.t + ((hi - v) / (hi - lo)) * (H - M.t - M.b);
    let d = `M${sx(points[0]!.at)},${sy(points[0]!.price)}`;
    for (let i = 1; i < points.length; i++) d += `H${sx(points[i]!.at)}V${sy(points[i]!.price)}`;
    d += `H${sx(x1)}`;
    const area = `${d}V${H - M.b}H${sx(points[0]!.at)}Z`;
    const yTicks = niceTicks(lo, hi).filter((v) => sy(v) >= M.t && sy(v) <= H - M.b);
    const xTicks = Array.from({ length: 4 }, (_, i) => x0 + ((x1 - x0) * i) / 3);
    const short = x1 - x0 < 36 * 3600_000;
    return { sx, sy, d, area, yTicks, xTicks, x1, short };
  }, [points, now]);

  if (!g) return <p className="muted">Chưa có dữ liệu giá.</p>;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(g.sx(points[i]!.at) - x) < Math.abs(g.sx(points[best]!.at) - x)) best = i;
    setActive(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? points.length) - 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  };

  const last = points[points.length - 1]!;
  const a = active !== null ? points[active]! : null;
  const prev = active !== null && active > 0 ? points[active - 1]! : null;
  const summary = `Giá từ ${formatManYen(points[0]!.price)} đến ${formatManYen(last.price)}, ${points.length} mốc`;

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label={summary}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {g.yTicks.map((v) => (
          <g key={v}>
            <line className="chart-grid" x1={M.l} x2={W - M.r} y1={g.sy(v)} y2={g.sy(v)} />
            <text className="chart-axis" x={M.l - 8} y={g.sy(v) + 4} textAnchor="end">
              {formatMillions(v)}
            </text>
          </g>
        ))}
        <line className="chart-baseline" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
        {g.xTicks.map((t, i) => (
          <text key={i} className="chart-axis" x={g.sx(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}>
            {g.short ? formatTime(t, tz) : formatMonthDay(t, tz)}
          </text>
        ))}
        <path className="chart-area" d={g.area} />
        <path className="chart-line" d={g.d} />
        {points.map((p, i) => (
          <circle key={i} className="chart-dot" cx={g.sx(p.at)} cy={g.sy(p.price)} r={4} />
        ))}
        <text className="chart-label" x={W - M.r + 6} y={g.sy(last.price) + 4}>
          {formatMillions(last.price)}
        </text>
        {a && <line className="chart-cross" x1={g.sx(a.at)} x2={g.sx(a.at)} y1={M.t} y2={H - M.b} />}
        {a && <circle className="chart-dot chart-dot-active" cx={g.sx(a.at)} cy={g.sy(a.price)} r={6} />}
        <rect
          x={M.l}
          y={M.t}
          width={W - M.l - M.r}
          height={H - M.t - M.b}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      {a && (
        <div className="chart-tip" style={{ left: `${(g.sx(a.at) / W) * 100}%` }}>
          <strong>{formatManYen(a.price)}</strong>
          <span>{formatDateTime(a.at, tz)}</span>
          {prev && (
            <span className={a.price < prev.price ? 'down' : 'up'}>
              {formatDiffManYen(a.price - prev.price)} ({formatPercent(((a.price - prev.price) / prev.price) * 100)})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
