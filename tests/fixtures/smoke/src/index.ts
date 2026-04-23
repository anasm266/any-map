/** Fixture: explicit annotations + one assertion (assertion ignored in m1). */

export const explicit: any = 1;

export function typedParam(x: any): number {
  return x;
}

export function returnsAny(): any {
  return 1;
}

const asserted = 1 as any;

void asserted;
