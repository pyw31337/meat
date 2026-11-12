import { useEffect, useMemo, useState } from 'react';
import {
  BEEF_COLOR,
  PORK_COLOR,
  chartSeries,
  dateRange,
  formatChartLabel,
  formatDate,
  getProductSeries,
  latestDate,
  parseObservations,
  productStats,
  shortName,
  valuesForDates,
} from './lib/priceData';

const RANGE_OPTIONS = [
  { label: '30일', value: 30 },
  { label: '90일', value: 90 },
  { label: '전체', value: 0 },
];

const UNIT_OPTIONS = [
  { label: '일별', value: 'day' },
  { label: '월별', value: 'month' },
  { label: '분기별', value: 'quarter' },
];

const number = new Intl.NumberFormat('ko-KR');

function lineSegments(values, width, height, pad) {
  const numeric = values.filter(Number.isFinite);
  if (!numeric.length) return { segments: [], min: 0, max: 1 };
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = max - min || Math.max(100, Math.round(max * 0.04));
  const xFor = (index) => pad + (index / Math.max(values.length - 1, 1)) * (width - pad * 2);
  const yFor = (value) => height - pad - ((value - min) / range) * (height - pad * 2);
  const segments = [];
  let segment = [];

  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    segment.push([xFor(index), yFor(value), value, index]);
  });
  if (segment.length) segments.push(segment);
  return { segments, min, max };
}

function pathFor(points) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

function Sparkline({ product, windowDates }) {
  const values = valuesForDates(product, windowDates);
  const { segments } = lineSegments(values, 240, 68, 7);
  const color = product.category === 'pork' ? PORK_COLOR : BEEF_COLOR;
  const latestIndex = values.findLastIndex(Number.isFinite);
  const latestPoint = segments.flat().find((point) => point[3] === latestIndex);

  return (
    <div className="spark-wrap" aria-label={`${shortName(product.name)} 최근 7일 가격 그래프`}>
      <svg className="sparkline" viewBox="0 0 240 68" role="img">
        <defs>
          <linearGradient id={`fill-${product.productId.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.3" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="spark-baseline" x1="7" x2="233" y1="60" y2="60" />
        {segments.map((segment, index) => (
          <path key={index} className="spark-path" d={pathFor(segment)} stroke={color} />
        ))}
        {latestPoint && <circle cx={latestPoint[0]} cy={latestPoint[1]} r="3.8" fill={color} className="spark-dot" />}
      </svg>
      <div className="spark-dates" aria-hidden="true">
        <span>{formatDate(windowDates[0], { month: 'numeric', day: 'numeric' })}</span>
        <span>{formatDate(windowDates.at(-1), { month: 'numeric', day: 'numeric' })}</span>
      </div>
    </div>
  );
}

function ProductCard({ product, dataEndDate, windowDates, isActive, onSelect }) {
  const stats = productStats(product, dataEndDate);
  const color = product.category === 'pork' ? PORK_COLOR : BEEF_COLOR;
  const priceUrl = /^\d+$/.test(product.productId) ? `https://www.megamart.com/product/${product.productId}` : null;
  const changeLabel = stats.change === null
    ? '7일 비교 데이터 없음'
    : `${stats.change > 0 ? '+' : ''}${number.format(stats.change)}원 · ${stats.changePercent > 0 ? '+' : ''}${stats.changePercent}%`;

  return (
    <article className={`product-card ${isActive ? 'is-active' : ''} ${stats.staleDays ? 'is-stale' : ''}`} style={{ '--product-color': color }}>
      <button
        type="button"
        className="product-focus"
        aria-pressed={isActive}
        aria-label={`${shortName(product.name)} ${isActive ? '선택 해제' : '그래프에 선택'}`}
        onClick={onSelect}
      >
        <div className="product-topline">
          <span className="product-type">{product.category === 'pork' ? 'PORK' : 'BEEF'}</span>
          {stats.staleDays > 0 && <span className="stale-badge">{stats.staleDays}일 전</span>}
        </div>
        <h3 title={product.name}>{shortName(product.name)}</h3>
        <div className="product-price"><strong>{number.format(stats.latest.price)}</strong><span>원 / 100g</span></div>
        <p className={`product-change ${stats.change > 0 ? 'up' : stats.change < 0 ? 'down' : ''}`}>{changeLabel}</p>
        <Sparkline product={product} windowDates={windowDates} />
        <dl className="product-stats">
          <div><dt>최저</dt><dd>{number.format(stats.minimum)}원</dd></div>
          <div><dt>평균</dt><dd>{number.format(stats.average)}원</dd></div>
          <div><dt>기록</dt><dd>{product.observations.length}회</dd></div>
        </dl>
      </button>
      {priceUrl && <a href={priceUrl} target="_blank" rel="noreferrer" className="buy-link">상품 보기 <span aria-hidden="true">↗</span></a>}
    </article>
  );
}

function PriceChart({ series, selectedProduct, onPoint }) {
  const width = 980;
  const height = 410;
  const pad = { top: 34, right: 28, bottom: 42, left: 66 };
  const allValues = series.products.flatMap((product) => product.values).filter(Number.isFinite);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 100;
  const yMin = Math.max(0, Math.floor((min - range * 0.12) / 100) * 100);
  const yMax = Math.ceil((max + range * 0.12) / 100) * 100;
  const yRange = yMax - yMin || 100;
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const xFor = (index) => pad.left + (index / Math.max(series.keys.length - 1, 1)) * innerWidth;
  const yFor = (value) => pad.top + (1 - (value - yMin) / yRange) * innerHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yRange * index) / 4);
  const labelStep = Math.max(1, Math.ceil(series.keys.length / 6));

  return (
    <div className="chart-shell">
      <svg className="main-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="선택한 기간의 상품별 100g당 가격 추이">
        <defs>
          <filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="grid-line" /><text x={pad.left - 12} y={y + 4} textAnchor="end" className="axis-label">{number.format(Math.round(tick))}</text></g>;
        })}
        {series.keys.map((key, index) => (index % labelStep === 0 || index === series.keys.length - 1) && (
          <text key={key} x={xFor(index)} y={height - 15} textAnchor={index === 0 ? 'start' : index === series.keys.length - 1 ? 'end' : 'middle'} className="axis-label">{formatChartLabel(key, series.unit)}</text>
        ))}
        {series.products.map((product) => {
          const color = product.category === 'pork' ? PORK_COLOR : BEEF_COLOR;
          const dimmed = selectedProduct && product.productId !== selectedProduct;
          const points = product.values.map((value, index) => (Number.isFinite(value) ? [xFor(index), yFor(value), value, index] : null));
          const segments = [];
          let segment = [];
          points.forEach((point) => { if (point) segment.push(point); else if (segment.length) { segments.push(segment); segment = []; } });
          if (segment.length) segments.push(segment);
          return <g key={product.productId} className={dimmed ? 'chart-line is-dimmed' : 'chart-line'}>
            {segments.map((points, index) => <path key={index} d={pathFor(points)} stroke={color} filter={selectedProduct === product.productId ? 'url(#glow)' : undefined} />)}
            {points.filter(Boolean).map(([x, y, value, index]) => <circle key={index} cx={x} cy={y} r={selectedProduct === product.productId ? 4 : 2.7} fill={color} onMouseEnter={() => onPoint({ product, value, key: series.keys[index], x, y })} onFocus={() => onPoint({ product, value, key: series.keys[index], x, y })} tabIndex="0"><title>{`${shortName(product.name)} · ${formatChartLabel(series.keys[index], series.unit)} · ${number.format(value)}원`}</title></circle>)}
          </g>;
        })}
      </svg>
    </div>
  );
}

export default function App() {
  const [observations, setObservations] = useState([]);
  const [error, setError] = useState('');
  const [rangeDays, setRangeDays] = useState(90);
  const [unit, setUnit] = useState('day');
  const [category, setCategory] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('./history/prices.csv', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('가격 기록을 불러오지 못했습니다.');
        return response.text();
      })
      .then((text) => { if (!cancelled) setObservations(parseObservations(text)); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, []);

  const dataEndDate = useMemo(() => latestDate(observations), [observations]);
  const products = useMemo(() => getProductSeries(observations), [observations]);
  const visibleProducts = useMemo(() => products
    .filter((product) => category === 'all' || product.category === category)
    .sort((a, b) => productStats(a, dataEndDate).latest.price - productStats(b, dataEndDate).latest.price), [products, category, dataEndDate]);
  const currentSeries = useMemo(() => ({ ...chartSeries(visibleProducts, unit, rangeDays, dataEndDate), unit }), [visibleProducts, unit, rangeDays, dataEndDate]);
  const windowDates = useMemo(() => dateRange(dataEndDate, 7), [dataEndDate]);

  useEffect(() => { setSelectedProduct(null); setHoveredPoint(null); }, [category, rangeDays, unit]);

  if (error) return <main className="state-screen"><p>데이터를 불러오지 못했습니다.</p><span>{error}</span></main>;
  if (!observations.length) return <main className="state-screen"><div className="loading-orb" /><p>가격 기록을 불러오는 중입니다</p></main>;

  return (
    <main className="page-shell">
      <header className="masthead">
        <a className="brand" href="./" aria-label="메가마트 가격 관측소 첫 화면">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><small>MEAT MARKET · PRICE WATCH</small><strong>가격 관측소</strong></span>
        </a>
        <div className="data-status"><span className="live-dot" />마지막 수집 <strong>{formatDate(dataEndDate, { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
      </header>

      <section className="hero-copy">
        <p className="eyebrow">100G UNIT PRICE / DAILY RECORD</p>
        <h1>고기를 고르는 <em>가장 맑은 기준.</em></h1>
        <p>상품별 단가를 분리해 기록하고, 중복 없는 일별 데이터로 가격 흐름을 보여드립니다.</p>
      </section>

      <section className="control-deck" aria-label="그래프 필터">
        <div className="segmented" role="group" aria-label="상품군">
          {[['all', '전체'], ['beef', '한우'], ['pork', '삼겹살']].map(([value, label]) => <button key={value} type="button" className={category === value ? `is-selected ${value}` : ''} onClick={() => setCategory(value)} aria-pressed={category === value}>{label}</button>)}
        </div>
        <div className="control-groups">
          <div className="segmented" role="group" aria-label="기간">{RANGE_OPTIONS.map((option) => <button key={option.value} type="button" className={rangeDays === option.value ? 'is-selected' : ''} onClick={() => setRangeDays(option.value)} aria-pressed={rangeDays === option.value}>{option.label}</button>)}</div>
          <div className="segmented subtle" role="group" aria-label="집계 단위">{UNIT_OPTIONS.map((option) => <button key={option.value} type="button" className={unit === option.value ? 'is-selected' : ''} onClick={() => setUnit(option.value)} aria-pressed={unit === option.value}>{option.label}</button>)}</div>
        </div>
      </section>

      <section className="hero-chart card-surface">
        <div className="chart-heading">
          <div><p className="section-kicker">PRICE TREND</p><h2>{category === 'all' ? '전체 상품 흐름' : category === 'beef' ? '한우 등심 흐름' : '국내산 삼겹살 흐름'}</h2></div>
          <div className="legend" aria-label="그래프 범례"><span><i className="legend-dot beef" />한우</span><span><i className="legend-dot pork" />삼겹살</span></div>
        </div>
        <PriceChart series={currentSeries} selectedProduct={selectedProduct} onPoint={setHoveredPoint} />
        <div className="chart-footnote"><span>가격 단위: 원 / 100g</span><span>{currentSeries.keys.length}개 기간 · 상품 클릭 시 강조</span></div>
        {hoveredPoint && <div className="chart-tooltip"><strong>{shortName(hoveredPoint.product.name)}</strong><span>{formatChartLabel(hoveredPoint.key, unit)} · {number.format(hoveredPoint.value)}원</span></div>}
      </section>

      <section className="product-section">
        <div className="section-heading"><div><p className="section-kicker">LATEST OBSERVATIONS</p><h2>상품별 가격 기록</h2></div><p>모든 미니 그래프는 <strong>{formatDate(windowDates[0], { month: 'numeric', day: 'numeric' })}–{formatDate(windowDates.at(-1), { month: 'numeric', day: 'numeric' })}</strong>의 동일한 7일 축입니다.</p></div>
        <div className="product-grid">
          {visibleProducts.map((product) => <ProductCard key={product.productId} product={product} dataEndDate={dataEndDate} windowDates={windowDates} isActive={selectedProduct === product.productId} onSelect={() => setSelectedProduct((active) => active === product.productId ? null : product.productId)} />)}
        </div>
      </section>

      <footer><span>가격은 매일 수집된 공개 판매가를 100g 단위로 환산합니다.</span><a href="https://github.com/pyw31337/meat" target="_blank" rel="noreferrer">데이터와 수집 방식 보기 ↗</a></footer>
    </main>
  );
}
