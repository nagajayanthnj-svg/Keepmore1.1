// Removes contact details from free text (seller policy text, buyer messages) before it goes into a case file.
// The words stay; emails, phone numbers and street addresses do not. Names cannot be found by pattern, which is
// why only synthetic demo data is ever sent to the AI provider (CLAUDE.md).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\d(?:[\s().-]?\d){8,}/g;
const STREET = /\b\d{1,5}[A-Za-z]?\s+(?:[A-Za-z.]+\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Marg|Nagar|Colony)\b\.?/gi;

export function scrubText(s: string): string {
  return s.replace(EMAIL, '[removed]').replace(PHONE, '[removed]').replace(STREET, '[removed]');
}
