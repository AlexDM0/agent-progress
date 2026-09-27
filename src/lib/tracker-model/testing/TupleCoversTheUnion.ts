/** A union member the tuple lacks leaves a remainder that is not `never`, so annotating `true` with this type fails the type check. */
export type TupleCoversTheUnion<Union, Tuple extends readonly unknown[]> = [Exclude<Union, Tuple[number]>] extends [never] ? true : false;
