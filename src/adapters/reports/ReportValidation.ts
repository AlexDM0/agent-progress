/**
 * Validates a value against the draft-07 subset the report schemas use, so the schema handed to the agent's command line and the check run
 * on its report are one source: `type`, `enum`, `const`, `properties`, `required`, `additionalProperties: false`, `items`, `minItems`,
 * `minLength`, `maxLength`, `pattern`, `anyOf`, `oneOf` and `if`/`then`. The schema type admits no other keyword, so none is silently ignored.
 */

export interface JsonSchema {
  $schema?:              string;
  title?:                string;
  type?:                 JsonSchemaType | readonly JsonSchemaType[];
  enum?:                 readonly unknown[];
  const?:                unknown;
  properties?:           Readonly<Record<string, JsonSchema>>;
  required?:             readonly string[];
  additionalProperties?: false;
  items?:                JsonSchema;
  minItems?:             number;
  minLength?:            number;
  maxLength?:            number;
  pattern?:              string;
  anyOf?:                readonly JsonSchema[];
  oneOf?:                readonly JsonSchema[];
  if?:                   JsonSchema;
  then?:                 JsonSchema;
}

type JsonSchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';

export type ReportVerdict = { verdict: 'valid' } | { verdict: 'invalid'; problems: string[] };

function typeOf(value: unknown): JsonSchemaType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

function typeMatches(value: unknown, expected: JsonSchemaType | readonly JsonSchemaType[]): boolean {
  const actual = typeOf(value);
  const allowed: readonly JsonSchemaType[] = typeof expected === 'string' ? [expected] : expected;
  return allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
}

function objectProblemsOf(schema: JsonSchema, value: Record<string, unknown>, path: string): string[] {
  const problems = (schema.required ?? []).filter((key) => !Object.hasOwn(value, key)).map((key) => `${path}.${key} is required`);
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = schema.properties !== undefined && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (propertySchema !== undefined) problems.push(...problemsOf(propertySchema, entry, `${path}.${key}`));
    else if (schema.additionalProperties === false) problems.push(`${path}.${key} is not allowed`);
  }
  return problems;
}

function stringProblemsOf(schema: JsonSchema, value: string, path: string): string[] {
  const problems: string[] = [];
  if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${path} is shorter than ${schema.minLength}`);
  if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${path} is longer than ${schema.maxLength}`);
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) problems.push(`${path} does not match ${schema.pattern}`);
  return problems;
}

function compositionProblemsOf(schema: JsonSchema, value: unknown, path: string): string[] {
  const problems: string[] = [];
  if (schema.anyOf !== undefined && !schema.anyOf.some((branch) => problemsOf(branch, value, path).length === 0)) problems.push(`${path} matches no anyOf branch`);
  if (schema.oneOf !== undefined) {
    const matches = schema.oneOf.filter((branch) => problemsOf(branch, value, path).length === 0).length;
    if (matches !== 1) problems.push(`${path} matches ${matches} oneOf branches, not one`);
  }
  if (schema.if !== undefined && schema.then !== undefined && problemsOf(schema.if, value, path).length === 0) problems.push(...problemsOf(schema.then, value, path));
  return problems;
}

function problemsOf(schema: JsonSchema, value: unknown, path: string): string[] {
  if (schema.type !== undefined && !typeMatches(value, schema.type)) return [`${path} is not of type ${String(schema.type)}`];
  if (schema.enum !== undefined && !schema.enum.includes(value)) return [`${path} is not one of ${schema.enum.join(', ')}`];
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return [`${path} is not ${String(schema.const)}`];
  const problems = compositionProblemsOf(schema, value, path);
  if (typeof value === 'string') problems.push(...stringProblemsOf(schema, value, path));
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path} has fewer than ${schema.minItems} items`);
    if (schema.items !== undefined) value.forEach((item, index) => problems.push(...problemsOf(schema.items as JsonSchema, item, `${path}[${index}]`)));
  }
  if (typeOf(value) === 'object') problems.push(...objectProblemsOf(schema, value as Record<string, unknown>, path));
  return problems;
}

export function reportVerdictOf(schema: JsonSchema, report: unknown): ReportVerdict {
  const problems = problemsOf(schema, report, '$');
  return problems.length === 0 ? { verdict: 'valid' } : { verdict: 'invalid', problems };
}
