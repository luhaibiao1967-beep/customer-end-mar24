export type CompanyLanguage = 'zh' | 'en' | 'id';
export const COMPANY_BUCKET = 'company-profile';
export const COMPANY_TEXT_FIELDS = [
  'pageTitle', 'eyebrow', 'headline', 'introduction', 'order', 'discover', 'heroAlt',
  'aboutLabel', 'aboutTitle', 'aboutBody', 'mission', 'servicesLabel', 'servicesTitle',
  'galleryLabel', 'galleryTitle', 'galleryBody', 'galleryAlt', 'contactLabel',
  'contactTitle', 'contactBody', 'phoneLabel', 'addressLabel', 'back',
] as const;
export type CompanyTextField = typeof COMPANY_TEXT_FIELDS[number];
export type CompanyProfile = Record<CompanyTextField, string> & {
  pillars: [string, string, string];
  services: { title: string; body: string }[];
};
export interface CompanyDocument {
  schemaVersion: 1;
  profiles: Record<CompanyLanguage, CompanyProfile>;
  contact: { phone: string; address: string };
  images: { hero: string; gallery: string[] };
}
export interface CompanyRecord { document: CompanyDocument; revision: number; updated_at: string }
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 5000): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function isCompanyImagePath(v: unknown): v is string {
  return typeof v === 'string' && (/^\/company\/(mascot|workshop-[123])\.webp$/.test(v) || /^company\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(v));
}
export function isCompanyDocument(v: unknown): v is CompanyDocument {
  if (!object(v) || v.schemaVersion !== 1 || !object(v.profiles) || !object(v.contact) || !object(v.images)) return false;
  if (!text(v.contact.address, 1000) || !text(v.contact.phone, 32) || !/^\+?[0-9 ()-]+$/.test(v.contact.phone) || !/^[0-9]{7,15}$/.test(v.contact.phone.replace(/\D/g, ''))) return false;
  if (!isCompanyImagePath(v.images.hero) || !Array.isArray(v.images.gallery) || v.images.gallery.length < 1 || v.images.gallery.length > 8 || !v.images.gallery.every(isCompanyImagePath) || new Set(v.images.gallery).size !== v.images.gallery.length) return false;
  return (['zh', 'en', 'id'] as const).every(language => {
    const p = (v.profiles as Record<string, unknown>)[language];
    return object(p) && COMPANY_TEXT_FIELDS.every(key => text(p[key])) && Array.isArray(p.pillars) && p.pillars.length === 3 && p.pillars.every(item => text(item)) && Array.isArray(p.services) && p.services.length === 3 && p.services.every(item => object(item) && text(item.title) && text(item.body));
  });
}
export function isCompanyRecord(v: unknown): v is CompanyRecord {
  return object(v) && isCompanyDocument(v.document) && Number.isSafeInteger(v.revision) && Number(v.revision) > 0 && typeof v.updated_at === 'string';
}
export function companyImageUrl(image: string, storagePublicUrl: (path: string) => string): string {
  return image.startsWith('/company/') ? `${import.meta.env.BASE_URL}${image.slice(1)}` : storagePublicUrl(image);
}
export const companyPhoneHref = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, '')}`;
