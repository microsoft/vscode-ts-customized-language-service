import type * as tsApi from "typescript/lib/tsserverlibrary";

export function decorateLanguageService(ts: typeof tsApi, service: tsApi.LanguageService): tsApi.LanguageService {
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

    function isChildOfFunctionInvocation(node: tsApi.Node): boolean {
        if (!node) { return false; }
        let parent = node.parent;
        while (parent) {
            if (!ts.isExpression(parent)) {
                return false;
            }
            if (ts.isCallExpression(parent)) {
                return true;
            }
            parent = parent.parent;
        }
        return false;
    }

    const s: tsApi.LanguageService = {
        ...service,
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

            if (result?.length !== 1) {
                return;
            }
            const def = result[0].definition;
            if (def.kind !== ts.ScriptElementKind.classElement) {
                return;
            }

            const classReferences = service.findReferences(def.fileName, def.textSpan.start);

            for (const rr of classReferences ?? []) {
                for (const r of rr.references) {
                    const sfr = service.getProgram()?.getSourceFile(r.fileName);
                    if (!sfr) { continue; }
                    const n = findLeafNodeAtPosition(sfr, r.textSpan.start);

                    if (n && isChildOfFunctionInvocation(n)) {
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
