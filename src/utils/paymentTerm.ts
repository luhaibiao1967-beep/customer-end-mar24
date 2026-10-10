export function getPaymentTermTranslationKey(term?: string | null): string {
  switch (term?.trim().toLowerCase()) {
    case 'daily':
      return 'billingTerm.daily';
    case 'weekly':
      return 'billingTerm.weekly';
    case 'monthly':
      return 'billingTerm.monthly';
    case 'quarterly':
      return 'billingTerm.quarterly';
    default:
      return 'billingTerm.notSet';
  }
}
