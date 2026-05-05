export const FORMAT_V1 = 1;
export const FORMAT_V2 = 2;
export const CURRENT_FORMAT = FORMAT_V2;

export function isSupportedFormat(v: number): boolean {
  return v === FORMAT_V1 || v === FORMAT_V2;
}
