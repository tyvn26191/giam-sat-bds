// Property fields the parsers try to recognise. Values are kept exactly as written on the
// site (Japanese); only whitespace is normalised. Missing fields are simply absent (= null).

export const FIELD_KEYS = [
  'projectName',
  'address',
  'landArea',
  'buildingArea',
  'floorArea',
  'layout',
  'propertyType',
  'builtDate',
  'deliveryDate',
  'listingStatus',
  'occupancy',
  'unitNumber',
  'propertyCode',
  'seller',
  'broker',
  'transactionType',
  'builder',
  'structure',
  'remarks',
  'access',
  'landRights',
  'postedDate',
  'updatedDate',
  'nextUpdateDate',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type Importance = 'high' | 'medium' | 'low';

export interface FieldDef {
  key: FieldKey;
  ja: string;
  vi: string;
  importance: Importance;
  /** Label synonyms as they appear in 物件概要 tables (compared after normalizeLabel). */
  labels: string[];
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'projectName', ja: '物件名', vi: 'Tên dự án /物件名', importance: 'medium', labels: ['物件名', '物件名称', 'マンション名', '建物名', '分譲地名', '現場名', 'プロジェクト名', '物件名称(分譲地名)'] },
  { key: 'address', ja: '所在地', vi: 'Địa chỉ', importance: 'high', labels: ['所在地', '住所', '物件所在地', '所在', '所在地(住居表示)'] },
  { key: 'landArea', ja: '土地面積', vi: 'Diện tích đất', importance: 'high', labels: ['土地面積', '敷地面積', '土地面積(公簿)', '土地面積(実測)', '土地'] },
  { key: 'buildingArea', ja: '建物面積', vi: 'Diện tích xây dựng', importance: 'high', labels: ['建物面積', '延床面積', '延べ床面積', '延床面積(建物面積)', '建物面積(延床面積)'] },
  { key: 'floorArea', ja: '専有面積', vi: 'Diện tích sàn', importance: 'high', labels: ['専有面積', '使用部分面積', '専有面積(壁芯)'] },
  { key: 'layout', ja: '間取り', vi: 'Bố cục / 間取り', importance: 'high', labels: ['間取り', '間取'] },
  { key: 'propertyType', ja: '物件種別', vi: 'Loại BĐS', importance: 'medium', labels: ['物件種別', '種別', '物件種目', '物件タイプ', '種目', '建物種別'] },
  { key: 'builtDate', ja: '築年月', vi: 'Năm xây dựng / 築年', importance: 'high', labels: ['築年月', '完成時期', '完成時期(築年月)', '築年数', '建築年月', '竣工時期', '竣工年月', '築年', '完成年月', '築年月(完成予定)'] },
  { key: 'deliveryDate', ja: '引渡時期', vi: 'Thời điểm bàn giao', importance: 'high', labels: ['引渡可能時期', '引渡し', '引渡時期', '引き渡し', '引渡', '入居時期', '入居可能時期', '引渡し時期', '引渡日', '引渡し可能時期', '入居可能日'] },
  { key: 'listingStatus', ja: '掲載状態', vi: 'Tình trạng đăng bán', importance: 'high', labels: ['販売状況', '掲載状態', '販売状態', 'ステータス', '物件状況'] },
  { key: 'occupancy', ja: '現況', vi: 'Hiện trạng', importance: 'medium', labels: ['現況', '現状'] },
  { key: 'unitNumber', ja: '号棟', vi: 'Số căn / 棟番号', importance: 'medium', labels: ['号棟', '棟番号', '区画', '区画番号', '号室', '部屋番号', '棟'] },
  { key: 'propertyCode', ja: '物件番号', vi: 'Mã BĐS', importance: 'medium', labels: ['物件番号', '物件ID', '管理番号', '物件コード', 'athome物件番号', 'ホームズ物件番号', 'SUUMO物件コード', '物件No', '物件NO', '物件No.', 'お問い合わせ番号'] },
  { key: 'seller', ja: '売主', vi: 'Chủ đầu tư / 売主', importance: 'medium', labels: ['売主', '事業主', '売主・事業主', '売主(事業主)', '売主・販売代理'] },
  { key: 'broker', ja: '仲介', vi: 'Môi giới / 仲介', importance: 'medium', labels: ['仲介', '販売会社', '情報提供会社', '取扱会社', '会社名', '不動産会社', '問合せ先', 'お問い合わせ先', '取扱い店舗', '販売代理'] },
  { key: 'transactionType', ja: '取引態様', vi: 'Hình thức giao dịch', importance: 'medium', labels: ['取引態様', '取引形態'] },
  { key: 'builder', ja: '施工', vi: 'Nhà thầu / 施工', importance: 'low', labels: ['施工', '施工会社'] },
  { key: 'structure', ja: '構造', vi: 'Kết cấu', importance: 'medium', labels: ['構造', '建物構造', '構造・工法', '構造・規模', '構造・階建'] },
  { key: 'remarks', ja: '備考', vi: 'Ghi chú / 備考', importance: 'medium', labels: ['備考', '特記事項', 'その他概要・特記事項', 'その他概要'] },
  { key: 'access', ja: '交通', vi: 'Giao thông', importance: 'low', labels: ['交通', '最寄駅', 'アクセス', '沿線・駅'] },
  { key: 'landRights', ja: '土地権利', vi: 'Quyền sử dụng đất', importance: 'low', labels: ['土地権利', '土地の権利形態', '権利', '土地の権利'] },
  { key: 'postedDate', ja: '情報公開日', vi: 'Ngày đăng', importance: 'low', labels: ['情報公開日', '掲載日', '情報提供日', '掲載開始日', '登録日'] },
  { key: 'updatedDate', ja: '更新日', vi: 'Ngày cập nhật', importance: 'low', labels: ['情報更新日', '更新日', '最終更新日'] },
  { key: 'nextUpdateDate', ja: '次回更新日', vi: 'Ngày cập nhật tiếp theo', importance: 'low', labels: ['次回更新日', '次回更新予定日'] },
];

export const FIELD_DEF: Record<FieldKey, FieldDef> = Object.fromEntries(
  FIELD_DEFS.map((d) => [d.key, d]),
) as Record<FieldKey, FieldDef>;

/** Labels that hold the asking price. */
export const PRICE_LABELS = ['価格', '販売価格', '新価格', '物件価格', '価格(税込)', '売買価格', '予定価格', '販売価格(税込)', '価格(税込み)'];

/** Normalise a table label: NFKC, no spaces, no trailing colon / hint marks. */
export function normalizeLabel(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[:：]+$/, '')
    .replace(/(ヒント|\?|？|※.*)$/u, '')
    .replace(/[［\[【].*?[］\]】]/g, '')
    .trim();
}

function stripParen(label: string): string {
  return label.replace(/\(.*?\)/g, '');
}

const LABEL_INDEX: Map<string, FieldKey | 'price'> = (() => {
  const m = new Map<string, FieldKey | 'price'>();
  for (const l of PRICE_LABELS) m.set(normalizeLabel(l), 'price');
  for (const d of FIELD_DEFS) for (const l of d.labels) if (!m.has(normalizeLabel(l))) m.set(normalizeLabel(l), d.key);
  return m;
})();

/** Map a table label to a field key (or 'price'), or null when unknown. */
export function fieldForLabel(raw: string): FieldKey | 'price' | null {
  const n = normalizeLabel(raw);
  if (!n || n.length > 30) return null;
  return LABEL_INDEX.get(n) ?? LABEL_INDEX.get(stripParen(n)) ?? null;
}

export function fieldLabel(key: string): string {
  if (key === 'price') return '価格';
  if (key === 'title') return '物件名(タイトル)';
  if (key === 'imageUrl') return 'メイン画像';
  return FIELD_DEF[key as FieldKey]?.ja ?? key;
}

export function fieldImportance(key: string): Importance {
  if (key === 'price') return 'high';
  if (key === 'title') return 'medium';
  if (key === 'imageUrl') return 'low';
  return FIELD_DEF[key as FieldKey]?.importance ?? 'low';
}
