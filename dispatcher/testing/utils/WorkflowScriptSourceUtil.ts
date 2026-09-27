/**
 * What the Workflow tool refuses in a script, read from its syntax tree: a clock or randomness, which would break a resumed run, a `meta`
 * that is anything but a pure literal, which the tool reads without running the script, and a top-level binding that shadows a Workflow global.
 */
import ts from 'typescript';

import type { MetaLiteralValue, MetaLiteralVerdict } from '../@types/MetaLiteral.ts';

const OFFENDER_TEXT_MAXIMUM_CHARACTERS = 60;

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
function nondeterministicCallsIn(source: string): string[] {
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

/** Counts the literal nodes under `node`, pushing a description of every node that is not one onto `offenders`. */
function literalNodeCountOf(node: ts.Node, sourceFile: ts.SourceFile, offenders: string[]): number {
  const offenderDescriptionOf = (offender: ts.Node): string => (
    `${ts.SyntaxKind[offender.kind]} at line ${lineOf(offender, sourceFile)}: ${offender.getText(sourceFile).slice(0, OFFENDER_TEXT_MAXIMUM_CHARACTERS)}`
  );
  if (isPureLiteralKind(node)) return 1;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.reduce((count, element) => count + literalNodeCountOf(element, sourceFile, offenders), 1);
  }
  if (ts.isObjectLiteralExpression(node)) {
    let count = 1;
    for (const property of node.properties) {
      const nameIsLiteral = ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name));
      if (ts.isPropertyAssignment(property) && nameIsLiteral) count += literalNodeCountOf(property.initializer, sourceFile, offenders);
      else offenders.push(offenderDescriptionOf(property));
    }
    return count;
  }
  offenders.push(offenderDescriptionOf(node));
  return 0;
}

function metaStatementOf(sourceFile: ts.SourceFile): { statement: ts.VariableStatement; declaration: ts.VariableDeclaration } | null {
  const [firstStatement] = sourceFile.statements;
  if (firstStatement === undefined || !ts.isVariableStatement(firstStatement)) return null;
  const declaration = firstStatement.declarationList.declarations[0];
  const isExported = firstStatement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  if (declaration === undefined || !isIdentifierNamed(declaration.name, 'meta') || !isExported) return null;
  return { statement: firstStatement, declaration };
}

/** `meta` must be the first statement, an exported `const`, and built of literals alone: no identifier, call, spread, computed key or template hole. */
function metaLiteralVerdictOf(source: string): MetaLiteralVerdict {
  const sourceFile = parsedScript(source);
  const metaStatement = metaStatementOf(sourceFile);
  if (metaStatement === null) return { verdict: 'absent' };
  const { statement, declaration } = metaStatement;
  const offenders: string[] = [];
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) offenders.push('meta is not declared with const');
  if (statement.declarationList.declarations.length !== 1) offenders.push('meta shares its statement with another declaration');
  if (declaration.initializer === undefined) return { verdict: 'impure', offenders: [...offenders, 'meta has no value'] };
  const literalNodeCount = literalNodeCountOf(declaration.initializer, sourceFile, offenders);
  return offenders.length === 0 ? { verdict: 'pure', literalNodeCount } : { verdict: 'impure', offenders };
}

function propertyKeyOf(name: ts.PropertyName): string {
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();
}

// Reached only through a meta the purity walk passed, so every node is one of the literal kinds it accepts.
function literalValueOf(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => literalValueOf(element));
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map((property) => [propertyKeyOf(property.name), literalValueOf(property.initializer)]));
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

/** The value of a pure `meta`, built from its literals without running any of the script. */
function metaLiteralValueOf(source: string): MetaLiteralValue {
  const verdict = metaLiteralVerdictOf(source);
  if (verdict.verdict !== 'pure') return { verdict: verdict.verdict };
  const initializer = metaStatementOf(parsedScript(source))?.declaration.initializer;
  return initializer === undefined ? { verdict: 'absent' } : { verdict: 'value', value: literalValueOf(initializer) };
}

function boundIdentifiersOf(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundIdentifiersOf(element.name)));
}

function topLevelIdentifiersDeclaredBy(statement: ts.Statement): ts.Identifier[] {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => boundIdentifiersOf(declaration.name));
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) return [statement.name];
  return [];
}

/** Every top-level `var`, `let`, `const` (destructured too), `function` and `class` after the meta statement whose name is one of `names`. */
function topLevelBindingsNamed(source: string, names: readonly string[]): string[] {
  const sourceFile = parsedScript(source);
  const statementsAfterMeta = sourceFile.statements.slice(metaStatementOf(sourceFile) === null ? 0 : 1);
  return statementsAfterMeta
    .flatMap((statement) => topLevelIdentifiersDeclaredBy(statement))
    .filter((identifier) => names.includes(identifier.text))
    .map((identifier) => `${identifier.text} at line ${lineOf(identifier, sourceFile)}`);
}

export const WorkflowScriptSourceUtil = {
  nondeterministicCallsIn,
  metaLiteralVerdictOf,
  metaLiteralValueOf,
  topLevelBindingsNamed,
} as const;
