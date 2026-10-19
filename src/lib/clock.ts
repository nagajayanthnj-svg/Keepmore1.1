// Code takes a Clock instead of calling new Date(), so tests control "now".
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** A clock frozen at one instant. Each call returns a fresh Date. */
export const fixedClock =
  (iso: string): Clock =>
  () =>
    new Date(iso);
