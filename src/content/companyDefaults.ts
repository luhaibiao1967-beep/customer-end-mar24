import { companyContact, companyProfiles } from './companyProfile';
import type { CompanyDocument } from './companySchema';
export const defaultCompanyDocument: CompanyDocument = {
  schemaVersion: 1,
  profiles: companyProfiles,
  contact: { phone: companyContact.phone, address: companyContact.address },
  images: { hero: '/company/mascot.webp', gallery: ['/company/workshop-1.webp', '/company/workshop-2.webp', '/company/workshop-3.webp'] },
};
