import type { ProductNames } from '../src/shared/constants/ProductNames.ts';

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

/** What an installed text names the product by, so a build's templates, skills and reference name its own program, folder and skills. */
export function productNameTemplateValuesOf(
  productNames: Pick<ProductNames, 'PROGRAM' | 'DATA_FOLDER' | 'PRODUCT_OWNER_SKILL' | 'ORCHESTRATE_SKILL'>,
): Readonly<Record<string, string>> {
  return {
    program:           productNames.PROGRAM,
    dataFolder:        productNames.DATA_FOLDER,
    productOwnerSkill: productNames.PRODUCT_OWNER_SKILL,
    orchestrateSkill:  productNames.ORCHESTRATE_SKILL,
  };
}

/** One pass over the template, so a value that itself holds a placeholder is written as it stands and never filled in turn. */
export function filledTemplateOf(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER_PATTERN, (placeholder: string, name: string) => (Object.hasOwn(values, name) ? values[name] ?? placeholder : placeholder));
}
