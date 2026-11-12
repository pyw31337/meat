import { useEffect, useMemo, useRef, useState } from 'react';
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
  recentRecords,
  shortName,
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
const BEEF_SERIES_COLORS = ['#c53f31', '#da6554', '#9b5545', '#e28a73'];
const PORK_SERIES_COLORS = ['#1f6fae', '#3689c7', '#639fd0', '#4d759d', '#78add6', '#315d88'];
const BEEF_CARD_ORDER = ['beef-grade-1pp', 'beef-grade-1p', 'beef-grade-1', 'beef-grade-1-1kg'];

function seriesColor(product, products) {
  const family = products.filter((item) => item.category === product.category);
  const index = family.findIndex((item) => item.productId === product.productId);
  const colors = product.category === 'pork' ? PORK_SERIES_COLORS : BEEF_SERIES_COLORS;
  return colors[index % colors.length];
}

function lineSegments(values, width, height, pad, dates = []) {
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
    if (segment.length && dates[index] && dates[index - 1]) {
      const previous = new Date(`${dates[index - 1]}T12:00:00Z`);
      const current = new Date(`${dates[index]}T12:00:00Z`);
      if ((current - previous) / 86_400_000 > 1) {
        segments.push(segment);
        segment = [];
      }
    }
    segment.push([xFor(index), yFor(value), value, index]);
  });
  if (segment.length) segments.push(segment);
  return { segments, min, max };
}

function pathFor(points) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

function Sparkline({ product }) {
  const records = recentRecords(product);
  const values = records.map((record) => record.price);
  const dates = records.map((record) => record.date);
  const { segments } = lineSegments(values, 240, 68, 7, dates);
  const color = product.category === 'pork' ? PORK_COLOR : BEEF_COLOR;
  const latestIndex = values.findLastIndex(Number.isFinite);
  const latestPoint = segments.flat().find((point) => point[3] === latestIndex);
  const singleRecord = records.length === 1;

  return (
    <div className="spark-wrap" aria-label={`${shortName(product.name)} 최근 ${records.length}회 수집 가격 그래프`}>
      <svg className="sparkline" viewBox="0 0 240 68" role="img">
        <defs>
          <linearGradient id={`fill-${product.productId.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.3" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="spark-baseline" x1="7" x2="233" y1="60" y2="60" />
        {dates.map((date, index) => {
          const x = 7 + (index / Math.max(dates.length - 1, 1)) * 226;
          return <line key={date} className="spark-guide" x1={x} x2={x} y1="57" y2="63" />;
        })}
        {singleRecord ? <><line x1="7" x2="233" y1="34" y2="34" className="spark-single-line" stroke={color} /><circle cx="120" cy="34" r="4" fill={color} className="spark-dot" /></> : <>{segments.map((segment, index) => (
          <path key={index} className="spark-path" d={pathFor(segment)} stroke={color} />
        ))}{latestPoint && <circle cx={latestPoint[0]} cy={latestPoint[1]} r="3.8" fill={color} className="spark-dot" />}</>}
      </svg>
      <div className={`spark-dates ${singleRecord ? 'is-single' : ''}`} aria-hidden="true">
        {singleRecord ? <span>{`${Number(dates[0].slice(5, 7))}.${Number(dates[0].slice(8, 10))} 첫 기록`}</span> : dates.map((date, index) => {
          const previous = dates[index - 1];
          const newMonth = !previous || previous.slice(5, 7) !== date.slice(5, 7);
          return <span key={date}>{newMonth ? `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}` : Number(date.slice(8, 10))}</span>;
        })}
      </div>
    </div>
  );
}

function ProductCard({ product, dataEndDate, isActive = false, onSelect, isSupplementary = false }) {
  const stats = productStats(product, dataEndDate);
  const color = product.category === 'pork' ? PORK_COLOR : BEEF_COLOR;
  const priceUrl = stats.latest.sourceProductId ? `https://www.megamart.com/product/${stats.latest.sourceProductId}` : null;
  const records = recentRecords(product);
  const changeLabel = stats.change === null
    ? isSupplementary ? '추세 데이터 수집 중' : '7회 비교 데이터 없음'
    : `${stats.change > 0 ? '+' : ''}${number.format(stats.change)}원 · ${stats.changePercent > 0 ? '+' : ''}${stats.changePercent}%`;

  const cardContents = <>
    <div className="product-topline">
      <span className="product-type">{isSupplementary ? `NEW ${product.category === 'pork' ? 'PORK' : 'BEEF'}` : product.category === 'pork' ? 'PORK' : 'BEEF'}</span>
      {stats.staleDays > 0 && <span className="stale-badge">{stats.staleDays}일 전</span>}
    </div>
    <h3 title={product.name}>{shortName(product.name)}</h3>
    <div className="product-price"><strong>{number.format(stats.latest.price)}</strong><span>원 / 100g</span></div>
    <p className={`product-change ${stats.change > 0 ? 'up' : stats.change < 0 ? 'down' : ''}`}>{changeLabel}</p>
    <Sparkline product={product} />
    <div className="record-meta"><span>{records.length === 1 ? '첫 수집 기록' : `최근 ${records.length}회 수집 기록`}</span><span>마지막 {formatDate(stats.latest.date, { month: 'numeric', day: 'numeric' })}</span></div>
    <dl className="product-stats">
      <div><dt>최저</dt><dd>{number.format(stats.minimum)}원</dd></div>
      <div><dt>최고</dt><dd>{number.format(stats.maximum)}원</dd></div>
      <div><dt>평균</dt><dd>{number.format(stats.average)}원</dd></div>
      <div><dt>기록</dt><dd>{product.observations.length}회</dd></div>
    </dl>
  </>;

  return (
    <article className={`product-card ${isActive ? 'is-active' : ''} ${stats.staleDays ? 'is-stale' : ''}`} style={{ '--product-color': color }}>
      {onSelect ? <button
        type="button"
        className="product-focus"
        aria-pressed={isActive}
        aria-label={`${shortName(product.name)} ${isActive ? '선택 해제' : '그래프에 선택'}`}
        onClick={onSelect}
      >{cardContents}</button> : <div className="product-focus product-static">{cardContents}</div>}
      {priceUrl && <a href={priceUrl} target="_blank" rel="noreferrer" className="buy-link">상품 보기 <span aria-hidden="true">↗</span></a>}
    </article>
  );
}

function PriceChart({ series, selectedProduct, onPoint }) {
  const scrollRef = useRef(null);
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

  useEffect(() => {
    const scrollNode = scrollRef.current;
    if (!scrollNode || !window.matchMedia('(max-width: 780px)').matches) return undefined;
    const frame = requestAnimationFrame(() => { scrollNode.scrollLeft = scrollNode.scrollWidth - scrollNode.clientWidth; });
    return () => cancelAnimationFrame(frame);
  }, [series.keys.length, series.unit]);

  return (
    <div className="chart-shell">
      <p className="mobile-chart-hint" aria-hidden="true">최근 기간부터 표시 중 · 좌우로 밀어 전체 기간 보기</p>
      <div className="chart-scroll" ref={scrollRef} tabIndex="0" aria-label="가격 추이 그래프. 모바일에서는 좌우로 밀어 전체 기간을 볼 수 있습니다.">
      <div className="chart-canvas">
      <svg className="main-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="선택한 기간의 상품별 100g당 가격 추이">
        <defs>
          <filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="grid-line" /><text x={pad.left - 12} y={y + 4} textAnchor="end" className="axis-label">{number.format(Math.round(tick))}</text><text x={width - pad.right - 3} y={y + 4} textAnchor="end" className="axis-label axis-label-mobile">{number.format(Math.round(tick))}</text></g>;
        })}
        {series.keys.map((key, index) => (index % labelStep === 0 || index === series.keys.length - 1) && (
          <text key={key} x={xFor(index)} y={height - 15} textAnchor={index === 0 ? 'start' : index === series.keys.length - 1 ? 'end' : 'middle'} className="axis-label">{formatChartLabel(key, series.unit)}</text>
        ))}
        {series.products.map((product) => {
          const color = seriesColor(product, series.products);
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
      </div>
    </div>
  );
}

function ChangeAnalysis({ products, dataEndDate }) {
  const rows = products
    .map((product) => ({ product, stats: productStats(product, dataEndDate) }))
    .filter(({ stats }) => stats.change !== null)
    .sort((a, b) => Math.abs(b.stats.changePercent) - Math.abs(a.stats.changePercent));
  const maxPercent = Math.max(...rows.map(({ stats }) => Math.abs(stats.changePercent)), 1);

  return (
    <section className="analysis-card card-surface" aria-labelledby="change-analysis-title">
      <div className="analysis-heading">
        <div><p className="section-kicker">WEEKLY CHANGE</p><h2 id="change-analysis-title">최근 7회 기준 변동</h2></div>
        <p>마지막 가격과 7번째 이전 수집 가격을 비교합니다.</p>
      </div>
      <div className="change-list">
        {rows.map(({ product, stats }) => {
          const positive = stats.change > 0;
          const width = `${Math.max(8, Math.round((Math.abs(stats.changePercent) / maxPercent) * 100))}%`;
          return <div className="change-row" key={product.productId}>
            <span title={product.name}>{shortName(product.name)}</span>
            <div className="change-track" aria-hidden="true"><i className={positive ? 'up' : 'down'} style={{ '--bar-width': width }} /></div>
            <strong className={positive ? 'up' : 'down'}>{positive ? '+' : ''}{stats.changePercent}%</strong>
          </div>;
        })}
      </div>
    </section>
  );
}

function CollectionTimeline({ observations, dataEndDate }) {
  const dates = dateRange(dataEndDate, 14);
  const counts = new Map();
  observations.forEach((item) => counts.set(item.date, (counts.get(item.date) ?? 0) + 1));

  return (
    <section className="collection-card card-surface" aria-labelledby="collection-title">
      <div className="analysis-heading">
        <div><p className="section-kicker">COLLECTION COVERAGE</p><h2 id="collection-title">최근 14일 수집 현황</h2></div>
        <p>칸의 숫자는 해당 날짜에 기록된 가격군 수입니다.</p>
      </div>
      <div className="collection-days">
        {dates.map((date) => {
          const count = counts.get(date) ?? 0;
          return <div className={count ? 'collection-day is-recorded' : 'collection-day'} key={date} title={`${date}: ${count}개 기록`}>
            <time dateTime={date}>{Number(date.slice(5, 7))}.{Number(date.slice(8, 10))}</time>
            <strong>{count || '–'}</strong>
          </div>;
        })}
      </div>
      <p className="collection-note"><i />기록된 날 <b>{dates.filter((date) => counts.has(date)).length}일</b> <span>·</span> <i className="empty" />기록 없음</p>
    </section>
  );
}

function SupplementaryProducts({ products, dataEndDate }) {
  if (!products.length) return null;
  return (
    <section className="supplementary-section" aria-labelledby="supplementary-title">
      <div className="section-heading"><div><p className="section-kicker">ADDITIONAL OBSERVATIONS</p><h2 id="supplementary-title">추가 구성 상품</h2></div><p>기존 가격군과 동일 상품으로 단정할 수 없는 구성은 별도 카드로 수집합니다. 7회 이상의 이력이 쌓이면 변동 분석에도 포함합니다.</p></div>
      <div className="product-grid supplementary-grid">
        {products.sort((a, b) => productStats(a, dataEndDate).latest.price - productStats(b, dataEndDate).latest.price).map((product) => <ProductCard key={product.productId} product={product} dataEndDate={dataEndDate} isSupplementary />)}
      </div>
    </section>
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
  const coreProducts = useMemo(() => products.filter((product) => product.isCore), [products]);
  const supplementaryProducts = useMemo(() => products.filter((product) => !product.isCore), [products]);
  const visibleProducts = useMemo(() => coreProducts
    .filter((product) => category === 'all' || product.category === category)
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === 'beef' ? -1 : 1;
      if (a.category === 'beef') return BEEF_CARD_ORDER.indexOf(a.productId) - BEEF_CARD_ORDER.indexOf(b.productId);
      return productStats(a, dataEndDate).latest.price - productStats(b, dataEndDate).latest.price;
    }), [coreProducts, category, dataEndDate]);
  const currentSeries = useMemo(() => ({ ...chartSeries(visibleProducts, unit, rangeDays, dataEndDate), unit }), [visibleProducts, unit, rangeDays, dataEndDate]);
  const windowDates = useMemo(() => dateRange(dataEndDate, 7), [dataEndDate]);
  const overview = useMemo(() => {
    const latestObservations = observations.filter((item) => item.date === dataEndDate);
    const recordedDays = windowDates.filter((date) => observations.some((item) => item.date === date)).length;
    const changes = visibleProducts.map((product) => productStats(product, dataEndDate).change).filter((change) => change !== null);
    return {
      latestCount: latestObservations.length,
      recordedDays,
      beefCount: coreProducts.filter((product) => product.category === 'beef').length,
      porkCount: coreProducts.filter((product) => product.category === 'pork').length,
      rising: changes.filter((change) => change > 0).length,
      falling: changes.filter((change) => change < 0).length,
      supplementaryCount: supplementaryProducts.length,
    };
  }, [coreProducts, dataEndDate, observations, supplementaryProducts, visibleProducts, windowDates]);

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

      <section className="page-intro">
        <div>
          <p className="eyebrow">MEGAMART · UNIT PRICE TRACKER</p>
          <h1>한우·삼겹살 가격 추이</h1>
          <p>메가마트 공개 판매가를 상품별로 분리해 100g 단가로 환산한 일별 기록입니다.</p>
        </div>
        <dl className="method-note">
          <div><dt>기록 기준</dt><dd>상품별 1일 1개 가격</dd></div>
          <div><dt>표시 단위</dt><dd>원 / 100g</dd></div>
          <div><dt>그래프 공백</dt><dd>수집 기록이 없는 날짜</dd></div>
        </dl>
      </section>

      <section className="overview-grid" aria-label="가격 기록 요약">
        <article><span>비교 상품군</span><strong>{coreProducts.length}<small>개</small></strong><p>한우 {overview.beefCount}개 · 삼겹살 {overview.porkCount}개 {overview.supplementaryCount ? `· 추가 ${overview.supplementaryCount}개` : ''}</p></article>
        <article><span>최근 관측 가격군</span><strong>{overview.latestCount}<small>개</small></strong><p>{formatDate(dataEndDate, { month: 'long', day: 'numeric' })}에 기록된 가격군</p></article>
        <article><span>최근 7일 기록</span><strong>{overview.recordedDays}<small> / 7일</small></strong><p>기록된 날짜만 선으로 표시합니다</p></article>
        <article><span>최근 7회 가격 변동</span><strong className="movement"><b>↑ {overview.rising}</b><b>↓ {overview.falling}</b></strong><p>비교 가능한 상품 기준</p></article>
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
        <div className="chart-footnote"><span>가격 단위: 원 / 100g · 기록이 없는 날짜는 선으로 연결하지 않습니다.</span><span>{currentSeries.keys.length}개 기간 · 상품 클릭 시 강조</span></div>
        {hoveredPoint && <div className="chart-tooltip"><strong>{shortName(hoveredPoint.product.name)}</strong><span>{formatChartLabel(hoveredPoint.key, unit)} · {number.format(hoveredPoint.value)}원</span></div>}
      </section>

      <section className="product-section">
        <div className="section-heading"><div><p className="section-kicker">LATEST OBSERVATIONS</p><h2>상품별 가격 기록</h2></div><p>미니 그래프는 <strong>최근 7회 실제 수집 값</strong>을 날짜와 함께 표시합니다. 날짜가 건너뛴 구간은 선으로 연결하지 않아 수집 공백을 숨기지 않습니다.</p></div>
        <div className="product-grid">
          {visibleProducts.map((product) => <ProductCard key={product.productId} product={product} dataEndDate={dataEndDate} isActive={selectedProduct === product.productId} onSelect={() => setSelectedProduct((active) => active === product.productId ? null : product.productId)} />)}
        </div>
      </section>

      {(category === 'all' || category === 'beef') && <SupplementaryProducts products={supplementaryProducts} dataEndDate={dataEndDate} />}

      <section className="analysis-grid">
        <ChangeAnalysis products={visibleProducts} dataEndDate={dataEndDate} />
        <CollectionTimeline observations={observations} dataEndDate={dataEndDate} />
      </section>

      <footer><span>가격은 매일 수집된 공개 판매가를 100g 단위로 환산합니다.</span><a href="https://github.com/pyw31337/meat" target="_blank" rel="noreferrer">데이터와 수집 방식 보기 ↗</a></footer>
    </main>
  );
}
