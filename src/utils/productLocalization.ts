import type { Language } from '../contexts/LanguageContext';

// Display aliases only. Keep catalog names/IDs unchanged for SKU matching,
// pricing, voucher eligibility and order payloads, including historical orders.
const chineseProductNames: Record<string, string> = {
  'gallon refill 19 liter': '19 升桶装水（补充装）',
  'galon refill 19 liter': '19 升桶装水（补充装）',
  'gallon 19 liter (gallon+refill)': '19 升桶装水（含新桶）',
  'broken gallon': '破损水桶',
  'empty gallon': '空水桶',
  'empty gallon collection': '空水桶回收',
  'electric pump': '电动抽水泵',
  'gallon rack': '水桶架',
  'sample gallon': '样品桶装水',
  'testing water gallon': '测试桶装水',
  'tukar gallon merk aqua 45 (promosi krukukut outlet)': 'AQUA 品牌水桶换购 45（Krukukut 门店促销）',
  'tukar gallon merk aqua 45 (promosi krukut outlet)': 'AQUA 品牌水桶换购 45（Krukut 门店促销）',
  'tukar gallon merk lain 36 (promosi krukut outlet)': '其他品牌水桶换购 36（Krukut 门店促销）',
};

const chineseUnits: Record<string, string> = {
  gallon: '桶', galon: '桶', gallons: '桶',
  pack: '包', packs: '包',
  piece: '件', pieces: '件', pcs: '件', pc: '件',
  bottle: '瓶', bottles: '瓶',
  kg: '公斤', kgs: '公斤',
  liter: '升', litre: '升', liters: '升', litres: '升',
  set: '套', unit: '件',
};

function normalizeCatalogLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getProductDisplayName(name: string | null | undefined, language: Language): string {
  if (!name) return '—';
  if (language !== 'zh') return name;
  const normalized = normalizeCatalogLabel(name);
  const knownName = chineseProductNames[normalized];
  if (typeof knownName === 'string') return knownName;
  // The size is part of the SKU: retain it rather than mapping every ice pack
  // to one label. Unknown catalog entries keep their original display name.
  const ice = /^ice tube (\d+(?:\.\d+)?) (?:kg|kgs)$/.exec(normalized);
  return ice ? `管状冰块（${ice[1]} 公斤）` : name;
}

export function getProductDisplayUnit(unit: string | null | undefined, language: Language): string {
  if (!unit) return '';
  if (language !== 'zh') return unit;
  const translated = chineseUnits[normalizeCatalogLabel(unit)];
  return typeof translated === 'string' ? translated : unit;
}

export function getVoucherPackageDisplayLabel(label: string | null | undefined, language: Language): string {
  if (!label) return '';
  if (language !== 'zh') return label;
  const vouchers = /^(\d+) vouchers?$/.exec(normalizeCatalogLabel(label));
  return vouchers ? `${vouchers[1]} 张代金券` : label;
}

export function getCatalogDisplayDescription(description: string, language: Language): string {
  if (language !== 'zh') return description;
  const offer = /^buy (\d+) gallons,? only cost ([\d,]+) per gallon(, buy more save more)?$/.exec(normalizeCatalogLabel(description));
  if (!offer) return description;
  return `购买 ${offer[1]} 桶，每桶仅 ${offer[2]} 印尼盾${offer[3] ? '，买得越多，省得越多' : ''}`;
}
