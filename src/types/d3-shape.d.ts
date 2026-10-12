declare module 'd3-shape' {
  export interface Line<Datum> {
    x(accessor: (d: Datum) => number): Line<Datum>;
    y(accessor: (d: Datum) => number): Line<Datum>;
    (data: Datum[]): string | null;
  }

  export function line<Datum>(): Line<Datum>;
}