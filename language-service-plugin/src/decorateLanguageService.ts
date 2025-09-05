import type * as tsApi from "typescript/lib/tsserverlibrary";
import { check, setTsApi } from "./propertyInitOrderChecker";

export function decorateLanguageService(ts: typeof tsApi, service: tsApi.LanguageService): tsApi.LanguageService {
    setTsApi(ts);

    function tryRedirectUntypedFieldToConstructorAssignment(fileName: string, position: number, originalResult: readonly tsApi.DefinitionInfo[] | undefined): readonly tsApi.DefinitionInfo[] | undefined {
        if (!originalResult || originalResult.length === 0) {
            return undefined;
        }

        // Get the source file and program
        const program = service.getProgram();
        if (!program) {
            return undefined;
        }
        
        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile) {
            return undefined;
        }

        // Find the node at the position
        const node = findLeafNodeAtPosition(sourceFile, position);
        if (!node) {
            return undefined;
        }

        // Check if we're on a property access that refers to a class field
        const definitionInfo = originalResult[0];
        if (!definitionInfo || definitionInfo.kind !== ts.ScriptElementKind.memberVariableElement) {
            return undefined;
        }

        // Get the definition source file and find the property declaration
        const defSourceFile = program.getSourceFile(definitionInfo.fileName);
        if (!defSourceFile) {
            return undefined;
        }

        const propertyDecl = findNodeAtPosition(defSourceFile, definitionInfo.textSpan.start);
        
        // If we didn't find a property declaration directly, maybe we need to search differently
        let finalPropertyDecl: tsApi.PropertyDeclaration | undefined = undefined;
        if (propertyDecl && ts.isPropertyDeclaration(propertyDecl)) {
            finalPropertyDecl = propertyDecl;
        } else {
            // Try to find the property declaration by traversing upwards from the found node
            let currentNode = propertyDecl;
            while (currentNode && !ts.isPropertyDeclaration(currentNode)) {
                currentNode = currentNode.parent;
            }
            if (currentNode && ts.isPropertyDeclaration(currentNode)) {
                finalPropertyDecl = currentNode;
            }
        }

        if (!finalPropertyDecl) {
            return undefined;
        }

        // Check if the property has no type annotation
        if (finalPropertyDecl.type) {
            return undefined; // Has type annotation, use default behavior
        }

        // Find the class that contains this property
        const classDecl = finalPropertyDecl.parent;
        if (!ts.isClassDeclaration(classDecl)) {
            return undefined;
        }

        // Find the constructor in the class
        const constructor = classDecl.members.find(member => ts.isConstructorDeclaration(member));
        if (!constructor || !ts.isConstructorDeclaration(constructor) || !constructor.body) {
            return undefined;
        }

        // Find the first top-level assignment to this property in the constructor
        const propertyName = finalPropertyDecl.name?.getText(defSourceFile);
        if (!propertyName) {
            return undefined;
        }

        const firstAssignment = findFirstTopLevelPropertyAssignment(constructor.body, propertyName, ts);
        if (!firstAssignment) {
            return undefined; // No assignment found, use default behavior
        }

        // Create a new DefinitionInfo pointing to just the property name part of the assignment
        const assignmentPropertyStart = firstAssignment.name.getStart(defSourceFile);
        const assignmentPropertyEnd = firstAssignment.name.getEnd();

        return [{
            ...definitionInfo,
            textSpan: {
                start: assignmentPropertyStart,
                length: assignmentPropertyEnd - assignmentPropertyStart
            },
            name: propertyName,
            kind: ts.ScriptElementKind.localVariableElement
        }];
    }

    function findNodeAtPosition(sourceFile: tsApi.SourceFile, position: number): tsApi.Node | undefined {
        function visit(node: tsApi.Node): tsApi.Node | undefined {
            if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
                return ts.forEachChild(node, visit) || node;
            }
            return undefined;
        }
        return visit(sourceFile);
    }

    function findFirstTopLevelPropertyAssignment(block: tsApi.Block, propertyName: string, ts: typeof tsApi): tsApi.PropertyAccessExpression | undefined {
        for (const statement of block.statements) {
            // Only consider top-level statements (skip nested blocks)
            if (ts.isExpressionStatement(statement)) {
                const expr = statement.expression;
                if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                    const left = expr.left;
                    if (ts.isPropertyAccessExpression(left) && 
                        left.expression.kind === ts.SyntaxKind.ThisKeyword && 
                        left.name.text === propertyName) {
                        return left; // Return the property access part of the assignment
                    }
                }
            }
        }
        return undefined;
    }

    function shouldIgnoreFirst(info: readonly tsApi.DefinitionInfo[]): boolean {
        if (info.length !== 2) { return false; }

        const [first, second] = info;

        if (first.fileName !== second.fileName) { return false; }

        if (first.kind !== ts.ScriptElementKind.classElement) { return false; }
        if (second.kind !== ts.ScriptElementKind.constructorImplementationElement) { return false; }

        if (first.name !== second.containerName) { return false; }

        return true;
    }

    function findLeafNodeAtPosition(sf: tsApi.SourceFile, pos: number): tsApi.Node | undefined {
        let node: tsApi.Node | undefined = sf;

        function findChildInPosition(currentNode: tsApi.Node): void {
            const children = currentNode.getChildren(sf);
            for (const child of children) {
                if (child.pos <= pos && child.end >= pos) {
                    node = child;
                    findChildInPosition(child);
                    break;
                }
            }
        }

        findChildInPosition(node);
        return node;
    }

    function isChildOfFunctionInvocationButNotPropertyAccess(node: tsApi.Node): boolean {
        if (!node) { return false; }
        let parent = node.parent;
        while (parent) {
            if (!ts.isExpression(parent)) {
                return false;
            }
            if (ts.isCallExpression(parent)) {
                return true;
            }
            if (ts.isPropertyAccessExpression(parent)) {
                return false;
            }
            parent = parent.parent;
        }
        return false;
    }

    const s: tsApi.LanguageService = {
        ...service,
        getSemanticDiagnostics: (fileName) => {
            const result = service.getSemanticDiagnostics(fileName);

            const sf = service.getProgram()?.getSourceFile(fileName);
            if (sf) {
                const errors = check(sf, service.getProgram()!, {
                    isCancellationRequested: () => false,
                    throwIfCancellationRequested: () => { },
                });
                for (const error of errors) {
                    result.push({
                        category: ts.DiagnosticCategory.Warning,
                        code: 0,
                        file: sf,
                        messageText: error.message,
                        start: error.node.pos,
                        length: error.node.end - error.node.pos,
                    });
                }
            }

            return result;
        },
        getDefinitionAndBoundSpan: (fileName, position) => {
            const result = service.getDefinitionAndBoundSpan(fileName, position);
            if (result?.definitions && shouldIgnoreFirst(result.definitions)) {
                return {
                    ...result,
                    definitions: result.definitions.slice(1),
                };
            }
            return result;
        },
        getDefinitionAtPosition: (fileName, position) => {
            const result = service.getDefinitionAtPosition(fileName, position);
            
            // Check for untyped class field redirection
            const redirectedResult = tryRedirectUntypedFieldToConstructorAssignment(fileName, position, result);
            if (redirectedResult) {
                return redirectedResult;
            }
            
            if (result && shouldIgnoreFirst(result)) {
                return result.slice(1);
            }
            return result;
        },
        findReferences: (fileName, position) => {
            const result = service.findReferences(fileName, position);

            const sf = service.getProgram()?.getSourceFile(fileName);
            if (!sf) { return result; }
            const n = findLeafNodeAtPosition(sf!, position);
            if (!n || n.kind !== ts.SyntaxKind.ConstructorKeyword) {
                return result;
            }
            // We are on the constructor

            if (!result || result.length === 0) {
                return result;
            }
            const def = result[0].definition;
            if (def.kind !== ts.ScriptElementKind.classElement) {
                return result;
            }

            const classReferences = service.findReferences(def.fileName, def.textSpan.start);

            for (const rr of classReferences ?? []) {
                for (const r of rr.references) {
                    const sfr = service.getProgram()?.getSourceFile(r.fileName);
                    if (!sfr) { continue; }
                    const n = findLeafNodeAtPosition(sfr, r.textSpan.start + 1);

                    if (n && isChildOfFunctionInvocationButNotPropertyAccess(n)) {
                        result[0].references.push(r);
                    }
                }
            }

            return result;
        }
    };

    return s;

    /*
    const p = new Proxy(s, {
        get(target, prop) {
            return (...args: any[]) => {
                const result = target[prop](...args);
                return result;
            };
        }
    })

    return p;*/
}
