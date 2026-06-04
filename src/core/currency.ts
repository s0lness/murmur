/**
 * One canonical currency for the whole pipeline. Valuations are stored as plain
 * numbers in this unit (the distiller converts anything the user says into it),
 * so a £400 budget and a £400 ask compare correctly and we never show a buyer a
 * price in a currency they didn't use. Configure with MURMUR_CURRENCY (a symbol
 * like "£", "€", "$"). Default "$".
 */
export const SYMBOL = (): string => process.env.MURMUR_CURRENCY ?? "$";

/** Format an amount with the canonical symbol, e.g. money(190) -> "£190". */
export const money = (n: number): string => `${SYMBOL()}${n}`;
