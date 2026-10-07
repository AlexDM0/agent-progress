/** The design's styles, the text of `resources/template.html`'s one `<style>` element, which the spec page takes in so both editions look alike. */
import { OperationRefusal }     from '../../shared/OperationRefusal.ts';
import { DESIGN_STYLE_ELEMENT } from './constants/TemplateFile.ts';

function refuseUnlessUnique(templateText: string, templateFilePath: string, token: string): void {
  const occurrenceCount = templateText.split(token).length - 1;
  if (occurrenceCount !== 1) {
    throw new OperationRefusal('unrepaired', {
      kind: 'template-token-not-unique', templateFilePath, token, occurrenceCount
    });
  }
}

/** Refuses, as unrepaired, a template holding other than exactly one `<style>` and one `</style>`. */
export function designStylesOf(templateText: string, templateFilePath: string): string {
  refuseUnlessUnique(templateText, templateFilePath, DESIGN_STYLE_ELEMENT.OPENING_TAG);
  refuseUnlessUnique(templateText, templateFilePath, DESIGN_STYLE_ELEMENT.CLOSING_TAG);
  const stylesStart = templateText.indexOf(DESIGN_STYLE_ELEMENT.OPENING_TAG) + DESIGN_STYLE_ELEMENT.OPENING_TAG.length;
  return templateText.slice(stylesStart, templateText.indexOf(DESIGN_STYLE_ELEMENT.CLOSING_TAG));
}
