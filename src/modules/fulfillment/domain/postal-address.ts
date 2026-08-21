export const POSTAL_CODE_DIGITS = 7;

export const JAPAN_PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export type JapanPrefecture = typeof JAPAN_PREFECTURES[number];
export type PostalCode = string & { readonly __brand: "PostalCode" };

export type PostalAddress = Readonly<{
  prefecture: JapanPrefecture;
  city: string;
  town: string;
}>;

export interface PostalAddressRepository {
  findByPostalCode(postalCode: PostalCode): Promise<readonly PostalAddress[]>;
}

export function normalizePostalCode(value: string): string {
  return value.normalize("NFKC").replace(/[\s-]/g, "");
}

export function isValidPostalCode(value: string): boolean {
  return /^\d{7}$/.test(normalizePostalCode(value));
}

export function postalCode(value: string): PostalCode {
  const normalized = normalizePostalCode(value);
  if (!/^\d{7}$/.test(normalized)) throw new InvalidPostalCodeError();
  return normalized as PostalCode;
}

export function formatPostalCode(value: string): string {
  const normalized = postalCode(value);
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
}

export function postalAddress(input: {
  prefecture: string;
  city: string;
  town: string;
}): PostalAddress {
  const prefecture = input.prefecture.trim();
  const city = input.city.trim();
  const town = input.town.trim();
  if (
    !JAPAN_PREFECTURES.includes(prefecture as JapanPrefecture)
    || !city
    || city.length > 100
    || town.length > 120
  ) {
    throw new InvalidPostalAddressError();
  }
  return { prefecture: prefecture as JapanPrefecture, city, town };
}

export class InvalidPostalCodeError extends Error {
  constructor() {
    super("郵便番号は 7 桁の数字で入力してください。");
    this.name = "InvalidPostalCodeError";
  }
}

export class InvalidPostalAddressError extends Error {
  constructor() {
    super("Postal address provider returned invalid data");
    this.name = "InvalidPostalAddressError";
  }
}
