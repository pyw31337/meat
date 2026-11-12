const DAY_MS = 24 * 60 * 60 * 1000;

export const BEEF_COLOR = '#d94734';
export const PORK_COLOR = '#2874c7';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value.replace(/\r$/, ''));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function categoryFor(name) {
  return name.includes('삼겹살') ? 'pork' : 'beef';
}

export function shortName(name) {
  return name
    .replace(/\s*\(국내산\)\s*/g, ' ')
    .replace(/한우\s*등심\s*/g, '')
    .replace(/돼지\s*/g, '')
    .replace(/구이용/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseObservations(csvText) {
  const [header = [], ...rows] = parseCsv(csvText);
  const headerIndex = new Map(header.map((field, index) => [field.trim(), index]));
  const dateIndex = headerIndex.get('date');
  const nameIndex = headerIndex.get('product_name');
  const priceIndex = headerIndex.get('price');
  const idIndex = headerIndex.get('product_id');

  if ([dateIndex, nameIndex, priceIndex].some((index) => index === undefined)) {
    throw new Error('가격 데이터 열 구성이 올바르지 않습니다.');
  }

  const daily = new Map();
  for (const row of rows) {
    const date = row[dateIndex]?.trim();
    const name = row[nameIndex]?.trim();
    const price = Number(row[priceIndex]);
    const productId = row[idIndex]?.trim() || `legacy:${name}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !Number.isFinite(price) || price <= 0) continue;

    // Legacy history did not retain a SKU. Retaining the daily lowest unit
    // price prevents its duplicate rows from distorting the dashboard.
    const key = `${date}\u0000${productId}`;
    const previous = daily.get(key);
    if (!previous || price < previous.price) {
      daily.set(key, { date, productId, name, price, category: categoryFor(name) });
    }
  }

  return [...daily.values()].sort((a, b) => (
    a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId)
  ));
}

export function latestDate(observations) {
  return observations.reduce((latest, item) => (item.date > latest ? item.date : latest), '');
}

export function shiftDate(isoDate, amount) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function dateRange(endDate, days) {
  if (!endDate || days <= 0) return [];
  return Array.from({ length: days }, (_, index) => shiftDate(endDate, index - days + 1));
}

export function groupKey(date, unit) {
  if (unit === 'month') return date.slice(0, 7);
  if (unit === 'quarter') {
    const month = Number(date.slice(5, 7));
    return `${date.slice(0, 4)}-Q${Math.ceil(month / 3)}`;
  }
  return date;
}

export function formatDate(isoDate, options = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', ...options })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

export function formatChartLabel(key, unit) {
  if (unit === 'day') return formatDate(key, { month: 'numeric', day: 'numeric' });
  if (unit === 'month') return `${Number(key.slice(5, 7))}월`;
  return `${key.slice(2, 4)} ${key.slice(5)}`;
}

export function getProductSeries(observations) {
  const products = new Map();
  for (const item of observations) {
    if (!products.has(item.productId)) products.set(item.productId, { ...item, observations: [] });
    products.get(item.productId).observations.push(item);
  }
  return [...products.values()].map((product) => ({
    ...product,
    observations: product.observations.sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

export function productStats(product, dataEndDate) {
  const values = product.observations.map((item) => item.price);
  const latest = product.observations.at(-1);
  const baselineDate = shiftDate(latest.date, -7);
  const baseline = [...product.observations].reverse().find((item) => item.date <= baselineDate);
  const change = baseline ? latest.price - baseline.price : null;

  return {
    latest,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    average: Math.round(values.reduce((total, value) => total + value, 0) / values.length),
    change,
    changePercent: baseline ? Math.round((change / baseline.price) * 100) : null,
    staleDays: dataEndDate ? Math.max(0, Math.round((new Date(`${dataEndDate}T12:00:00Z`) - new Date(`${latest.date}T12:00:00Z`)) / DAY_MS)) : 0,
  };
}

export function valuesForDates(product, dates) {
  const byDate = new Map(product.observations.map((item) => [item.date, item.price]));
  return dates.map((date) => byDate.get(date) ?? null);
}

export function chartSeries(products, unit, rangeDays, dataEndDate) {
  if (!dataEndDate || !products.length) return { keys: [], products: [] };
  const startDate = rangeDays ? shiftDate(dataEndDate, -rangeDays + 1) : '';
  const filtered = products.map((product) => ({
    ...product,
    observations: product.observations.filter((item) => !startDate || item.date >= startDate),
  })).filter((product) => product.observations.length);

  const keys = [...new Set(filtered.flatMap((product) => product.observations.map((item) => groupKey(item.date, unit))))].sort();
  return {
    keys,
    products: filtered.map((product) => {
      const grouped = new Map();
      for (const item of product.observations) {
        const key = groupKey(item.date, unit);
        const values = grouped.get(key) ?? [];
        values.push(item.price);
        grouped.set(key, values);
      }
      return {
        ...product,
        values: keys.map((key) => {
          const values = grouped.get(key);
          return values ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
        }),
      };
    }),
  };
}
