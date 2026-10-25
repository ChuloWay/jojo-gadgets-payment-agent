export function koboToNaira(kobo: number | string | bigint): number {
  const numeric = typeof kobo === 'bigint' ? Number(kobo) : Number(kobo);
  if (!Number.isSafeInteger(numeric)) throw new Error('Amount is outside the safe integer range');
  return numeric / 100;
}

export function formatNaira(kobo: number | string | bigint): string {
  return `₦${koboToNaira(kobo).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}
