
import path from "path";
import type * as tsApi from "typescript/lib/tsserverlibrary";
let ts: typeof tsApi;

export function setTsApi(api: typeof tsApi) {
    ts = api;
}

export function check(sf: tsApi.SourceFile, program: tsApi.Program, token: tsApi.CancellationToken): InvalidUseDiagnostic[] {
    const result: InvalidUseDiagnostic[] = [];

    function visit(node: tsApi.Node) {
        if (ts.isParameter(node) && ts.isParameterPropertyDeclaration(node, node.parent)) {
            const errs = checkParameterPropertyDeclaration(node, program, token);
            for (const e of errs) {
                result.push({
                    message: `Parameter property '${node.name.getText()}' is used before its declaration. Usage stack: ${formatStack(e.stack)}`,
                    node: e.stack[0],
                });
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sf);
    return result;
}

export interface InvalidUseDiagnostic {
    message: string;
    node: tsApi.Node;
}

function checkParameterPropertyDeclaration(param: tsApi.ParameterPropertyDeclaration, program: tsApi.Program, token: tsApi.CancellationToken) {
    const uses = [...collectReferences(param.name, [], 0, new Set(), program, token)];
    return uses;
}

interface InvalidUse {
    stack: tsApi.Node[];
    container: ReferenceContainer;
}

function* collectReferences(node: tsApi.Node, stack: tsApi.Node[], requiresInvocationDepth: number = 0, seen = new Set<ReferenceContainer>(), program: tsApi.Program, token: tsApi.CancellationToken): Generator<InvalidUse> {
    for (const use of findAllReferencesInClass(node, program, token)) {
        const container = findContainer(use);
        if (!container || seen.has(container) || ts.isConstructorDeclaration(container)) {
            continue;
        }
        seen.add(container);

        const nextStack = [...stack, use];

        let nextRequiresInvocationDepth = requiresInvocationDepth;
        if (isInvocation(use) && nextRequiresInvocationDepth > 0) {
            nextRequiresInvocationDepth--;
        }

        if (ts.isPropertyDeclaration(container) && nextRequiresInvocationDepth === 0) {
            yield { stack: nextStack, container };
        }
        else if (requiresInvocation(container)) {
            nextRequiresInvocationDepth++;
        }

        yield* collectReferences(container.name ?? container, nextStack, nextRequiresInvocationDepth, seen, program, token);
    }
}

function requiresInvocation(definition: ReferenceContainer): boolean {
    return ts.isMethodDeclaration(definition) || ts.isFunctionDeclaration(definition) || ts.isFunctionExpression(definition) || ts.isArrowFunction(definition);
}

function isInvocation(use: tsApi.Node): boolean {
    let location = use;
    if (ts.isPropertyAccessExpression(location.parent) && location.parent.name === location) {
        location = location.parent;
    }
    else if (ts.isElementAccessExpression(location.parent) && location.parent.argumentExpression === location) {
        location = location.parent;
    }
    return ts.isCallExpression(location.parent) && location.parent.expression === location
        || ts.isTaggedTemplateExpression(location.parent) && location.parent.tag === location;
}

function formatFileName(node: tsApi.Node): string {
    const sourceFile = node.getSourceFile();
    return path.resolve(sourceFile.fileName);
}

function formatLocation(node: tsApi.Node): string {
    const sourceFile = node.getSourceFile();
    const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, node.pos);
    return `${formatFileName(sourceFile)}(${line + 1},${character + 1})`;
}

function formatStack(stack: tsApi.Node[]): string {
    return stack.slice().reverse().map((use) => formatUse(use)).join(' -> ');
}

function formatMember(container: ReferenceContainer): string {
    const name = container.name?.getText();
    if (name) {
        const className = findClass(container)?.name?.getText();
        if (className) {
            return `${className}.${name}`;
        }
        return name;
    }
    return '<unknown>';
}

function formatUse(use: tsApi.Node): string {
    let text = use.getText();
    if (use.parent && ts.isPropertyAccessExpression(use.parent) && use.parent.name === use) {
        if (use.parent.expression.kind === ts.SyntaxKind.ThisKeyword) {
            text = `this.${text}`;
        }
        use = use.parent;
    }
    else if (use.parent && ts.isElementAccessExpression(use.parent) && use.parent.argumentExpression === use) {
        if (use.parent.expression.kind === ts.SyntaxKind.ThisKeyword) {
            text = `this['${text}']`;
        }
        use = use.parent;
    }
    if (ts.isCallExpression(use.parent)) {
        text = `${text}(...)`;
    }
    return text;
}

type ReferenceContainer =
    | tsApi.PropertyDeclaration
    | tsApi.MethodDeclaration
    | tsApi.GetAccessorDeclaration
    | tsApi.SetAccessorDeclaration
    | tsApi.ConstructorDeclaration
    | tsApi.ClassStaticBlockDeclaration
    | tsApi.ArrowFunction
    | tsApi.FunctionExpression
    | tsApi.FunctionDeclaration
    | tsApi.ParameterDeclaration;

function findContainer(node: tsApi.Node): ReferenceContainer | undefined {
    return ts.findAncestor(node, ancestor => {
        switch (ancestor.kind) {
            case ts.SyntaxKind.PropertyDeclaration:
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.SetAccessor:
            case ts.SyntaxKind.Constructor:
            case ts.SyntaxKind.ClassStaticBlockDeclaration:
            case ts.SyntaxKind.ArrowFunction:
            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.FunctionDeclaration:
            case ts.SyntaxKind.Parameter:
                return true;
        }
        return false;
    }) as ReferenceContainer | undefined;
}

function findClass(node: tsApi.Node): tsApi.ClassLikeDeclaration | undefined {
    return ts.findAncestor(node, ts.isClassLike);
}

function* findAllReferencesInClass(node: tsApi.Node, program: tsApi.Program, token: tsApi.CancellationToken): Generator<tsApi.Node> {
    const classDecl = findClass(node);
    if (!classDecl) {
        return [];
    }
    for (const ref of findAllReferences(node, program, token)) {
        for (const entry of ref.references) {
            if (entry.kind !== EntryKind.Node || entry.node === node) {
                continue;
            }
            if (findClass(entry.node) === classDecl) {
                yield entry.node;
            }
        }
    }
}

// NOTE: The following uses TypeScript internals and are subject to change from version to version.

function findAllReferences(node: tsApi.Node, program: tsApi.Program, token: tsApi.CancellationToken): readonly SymbolAndEntries[] {
    const sourceFile = node.getSourceFile();
    const position = node.getStart();
    const name: tsApi.Node = (ts as any).getTouchingPropertyName(sourceFile, position);
    const options = { use: (ts as any).FindAllReferences.FindReferencesUse.References };
    return (ts as any).FindAllReferences.Core.getReferencedSymbolsForNode(position, name, program, [sourceFile], token, options) ?? [];
}

interface SymbolAndEntries {
    readonly definition: Definition | undefined;
    readonly references: readonly Entry[];
}

const enum DefinitionKind {
    Symbol,
    Label,
    Keyword,
    This,
    String,
    TripleSlashReference,
}

type Definition =
    | { readonly type: DefinitionKind.Symbol; readonly symbol: tsApi.Symbol }
    | { readonly type: DefinitionKind.Label; readonly node: tsApi.Identifier }
    | { readonly type: DefinitionKind.Keyword; readonly node: tsApi.Node }
    | { readonly type: DefinitionKind.This; readonly node: tsApi.Node }
    | { readonly type: DefinitionKind.String; readonly node: tsApi.StringLiteralLike }
    | { readonly type: DefinitionKind.TripleSlashReference; readonly reference: tsApi.FileReference; readonly file: tsApi.SourceFile };

/** @internal */
export const enum EntryKind {
    Span,
    Node,
    StringLiteral,
    SearchedLocalFoundProperty,
    SearchedPropertyFoundLocal,
}
type NodeEntryKind = EntryKind.Node | EntryKind.StringLiteral | EntryKind.SearchedLocalFoundProperty | EntryKind.SearchedPropertyFoundLocal;
type Entry = NodeEntry | SpanEntry;
interface ContextWithStartAndEndNode {
    start: tsApi.Node;
    end: tsApi.Node;
}
type ContextNode = tsApi.Node | ContextWithStartAndEndNode;
interface NodeEntry {
    readonly kind: NodeEntryKind;
    readonly node: tsApi.Node;
    readonly context?: ContextNode;
}
interface SpanEntry {
    readonly kind: EntryKind.Span;
    readonly fileName: string;
    readonly textSpan: tsApi.TextSpan;
}
