const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

/** One pass over the template, so a value that itself holds a placeholder is written as it stands and never filled in turn. */
export function filledTemplateOf(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER_PATTERN, (placeholder: string, name: string) => (Object.hasOwn(values, name) ? values[name] ?? placeholder : placeholder));
}
