export type MetaLiteralVerdict =
  | { verdict: 'pure'; literalNodeCount: number }
  | { verdict: 'impure'; offenders: string[] }
  | { verdict: 'absent' };

export type MetaLiteralValue = { verdict: 'value'; value: unknown } | { verdict: 'impure' | 'absent' };
