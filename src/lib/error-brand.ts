// Recognising our own error classes when a bundler has loaded their module twice (the running Next server does).
// `instanceof` then fails against the other copy's class. Each class carries a global brand, `Symbol.for`, which both
// copies share. Never constructor.name: a minified build can rename classes.
export const errorBrand = (className: string): symbol => Symbol.for(`keepmore.error.${className}`);

export function hasErrorBrand(e: unknown, className: string): e is Error {
  return e instanceof Error && (e as unknown as Record<symbol, unknown>)[errorBrand(className)] === true;
}
