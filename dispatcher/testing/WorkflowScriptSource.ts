/**
 * What the Workflow tool refuses in a script, read from its syntax tree: a clock or randomness, which would break a resumed run, and a `meta`
 * that is anything but a pure literal, which the tool reads without running the script.
 */
import ts from 'typescript';

export type MetaLiteralVerdict =
  | { verdict: 'pure'; literalNodeCount: number }
  | { verdict: 'impure'; offenders: string[] }
  | { verdict: 'absent' };

const NONDETERMINISTIC_MEMBERS: Record<string, string> = { Date: 'now', Math: 'random' };

function parsedScript(source: string): ts.SourceFile {
  return ts.createSourceFile('workflow.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isIdentifierNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function nondeterministicMemberAccessed(node: ts.Node): string | null {
  const accessedObject = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
  if (accessedObject === null || !ts.isIdentifier(accessedObject) || !Object.hasOwn(NONDETERMINISTIC_MEMBERS, accessedObject.text)) return null;
  let memberName: string | null = null;
  if (ts.isPropertyAccessExpression(node)) memberName = node.name.text;
  else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) memberName = node.argumentExpression.text;
  return memberName === NONDETERMINISTIC_MEMBERS[accessedObject.text] ? `${accessedObject.text}.${memberName}` : null;
}

/** Every `Date.now`, `Math.random`, argless `new Date()` and bare `Date()` call in the script, each with its line. */
export function nondeterministicCallsIn(source: string): string[] {
  const sourceFile = parsedScript(source);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const member = nondeterministicMemberAccessed(node);
    if (member !== null) found.push(`${member} at line ${lineOf(node, sourceFile)}`);
    if (ts.isNewExpression(node) && isIdentifierNamed(node.expression, 'Date') && (node.arguments?.length ?? 0) === 0) {
      found.push(`new Date() at line ${lineOf(node, sourceFile)}`);
    }
    if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, 'Date')) found.push(`Date() at line ${lineOf(node, sourceFile)}`);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isPureLiteralKind(node: ts.Node): boolean {
  return ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword
    || (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand));
}

function impureNodesIn(node: ts.Node, sourceFile: ts.SourceFile, offenders: string[]): number {
  const describe = (offender: ts.Node): string => `${ts.SyntaxKind[offender.kind]} at line ${lineOf(offender, sourceFile)}: ${offender.getText(sourceFile).slice(0, 60)}`;
  if (isPureLiteralKind(node)) return 1;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.reduce((count, element) => count + impureNodesIn(element, sourceFile, offenders), 1);
  }
  if (ts.isObjectLiteralExpression(node)) {
    let count = 1;
    for (const property of node.properties) {
      const nameIsLiteral = ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name));
      if (ts.isPropertyAssignment(property) && nameIsLiteral) count += impureNodesIn(property.initializer, sourceFile, offenders);
      else offenders.push(describe(property));
    }
    return count;
  }
  offenders.push(describe(node));
  return 0;
}

/** `meta` must be the first statement, an exported `const`, and built of literals alone: no identifier, call, spread, computed key or template hole. */
export function metaLiteralVerdictOf(source: string): MetaLiteralVerdict {
  const sourceFile = parsedScript(source);
  const [firstStatement] = sourceFile.statements;
  if (firstStatement === undefined || !ts.isVariableStatement(firstStatement)) return { verdict: 'absent' };
  const declaration = firstStatement.declarationList.declarations[0];
  const isExported = firstStatement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  if (declaration === undefined || !isIdentifierNamed(declaration.name, 'meta') || !isExported) return { verdict: 'absent' };
  const offenders: string[] = [];
  if ((firstStatement.declarationList.flags & ts.NodeFlags.Const) === 0) offenders.push('meta is not declared with const');
  if (firstStatement.declarationList.declarations.length !== 1) offenders.push('meta shares its statement with another declaration');
  if (declaration.initializer === undefined) return { verdict: 'impure', offenders: [...offenders, 'meta has no value'] };
  const literalNodeCount = impureNodesIn(declaration.initializer, sourceFile, offenders);
  return offenders.length === 0 ? { verdict: 'pure', literalNodeCount } : { verdict: 'impure', offenders };
}
