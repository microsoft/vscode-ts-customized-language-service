import * as ts from "typescript";

export function withLanguageService(
    content: string | Record<string, string>,
    testFn: (tsApi: typeof ts, languageService: ts.LanguageService, sf: ts.SourceFile, markers: number[]) => void,
): void {
    if (typeof content === "string") {
        content = { "root/main.ts": content };
    }

    const files = new Map<string, string>(
        Object.entries(content).map(([key, value]) => [key, stripMarkers(value).stripped])
    );
    const serviceHost = new VirtualLanguageServiceHost(files, { strict: true, strictNullChecks: true });
    const baseService = ts.createLanguageService(
        serviceHost,
        ts.createDocumentRegistry()
    );

    testFn(ts, baseService, baseService.getProgram()!.getSourceFile(Object.keys(content)[0])!, stripMarkers(Object.values(content)[0]).markers);
}

export class VirtualLanguageServiceHost implements ts.LanguageServiceHost {
    constructor(
        private readonly files: Map<string, string>,
        private readonly compilationSettings: ts.CompilerOptions
    ) { }

    public getScriptFileNames(): string[] {
        return [...this.files.keys()];
    }

    public getScriptVersion(fileName: string): string {
        return "1.0"; // our files don't change
    }

    public getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
        let content = this.files.get(fileName);
        
        // Provide lib files for proper type checking
        if (!content && fileName.indexOf('lib.') >= 0) {
            try {
                const libPath = require.resolve('typescript').replace(/typescript\.js$/, fileName.replace(/.*\//, ''));
                content = ts.sys.readFile(libPath);
            } catch (e) {
                // If we can't load lib files, that's ok for basic tests
            }
        }
        
        if (!content) {
            return undefined;
        }
        return {
            dispose() { },
            getChangeRange: () => undefined,
            getLength: () => content.length,
            getText: (start, end) => content.substr(start, end - start),
        };
    }

    public getCompilationSettings(): ts.CompilerOptions {
        return this.compilationSettings;
    }

    public getCurrentDirectory(): string {
        return "/";
    }

    public getDefaultLibFileName(options: ts.CompilerOptions): string {
        return ts.getDefaultLibFileName(options);
    }

    public readFile(path: string, encoding?: string): string | undefined {
        return this.files.get(path);
    }

    public fileExists(path: string): boolean {
        if (this.files.has(path)) {
            return true;
        }
        // Check if it's a lib file
        if (path.indexOf('lib.') >= 0) {
            try {
                const libPath = require.resolve('typescript').replace(/typescript\.js$/, path.replace(/.*\//, ''));
                return ts.sys.fileExists(libPath);
            } catch (e) {
                return false;
            }
        }
        return false;
    }
}

function stripMarkers(src: string): { stripped: string; markers: number[] } {
    let stripped = "";
    const markers = new Array<number>();
    let i = 0;
    
    // Improved logic: only treat | as a marker if it's NOT surrounded by spaces
    // Markers are like: identi|fier (no spaces)
    // Union types are like: Type | Other (with spaces)
    for (let idx = 0; idx < src.length; idx++) {
        const char = src[idx];
        
        if (char === '|') {
            // Check if this is a marker (no spaces around it) or a union type operator (spaces around it)
            const prevChar = idx > 0 ? src[idx - 1] : '';
            const nextChar = idx < src.length - 1 ? src[idx + 1] : '';
            
            // Union types have spaces: "A | B"
            // Markers don't: "identifi|er"
            const hasSpaceBefore = /\s/.test(prevChar) || prevChar === '';
            const hasSpaceAfter = /\s/.test(nextChar) || nextChar === '';
            const isUnionType = hasSpaceBefore && hasSpaceAfter;
            
            if (!isUnionType) {
                // This is a marker, record position and skip it
                markers.push(i);
                continue;
            }
        }
        
        stripped += char;
        i++;
    }
    
    return {
        stripped,
        markers,
    };
}

export function normalizeDiagnostics(diagnostics: readonly ts.Diagnostic[] | undefined, program: ts.Program | undefined) {
    if (!diagnostics || !program) {
        return undefined;
    }
    const result: string[] = [];

    for (const diagnostic of diagnostics) {
        const fileName = diagnostic.file?.fileName;
        if (!fileName) continue;

        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile) continue;

        result.push('diag: ' + format({ fileName: fileName, textSpan: { start: diagnostic.start!, length: diagnostic.length! } }, program) + `\n-> ${diagnostic.messageText}`)
    }
    return result;
}

export function normalizeDefInfos(defInfos: readonly (ts.DefinitionInfo | ts.ReferenceEntry)[] | undefined, program: ts.Program | undefined) {
    if (!defInfos || !program) {
        return undefined;
    }
    const result: string[] = [];
    for (const defInfo of defInfos) {
        const text = format({ fileName: defInfo.fileName, textSpan: defInfo.textSpan }, program);
        if (!text) continue;

        result.push(text);
    }
    return result;
}

export function normalizeReferencedSymbols(refs: ts.ReferencedSymbol[] | undefined, program: ts.Program | undefined) {
    if (!refs || !program) {
        return undefined;
    }

    const result: string[] = [];
    for (const ref of refs) {
        const definitionText = format(ref.definition, program);
        if (definitionText) {
            result.push('def:' + definitionText);
        }

        for (const r of ref.references) {
            const markedText = format(r, program);
            if (markedText) {
                result.push('ref: ' + markedText);
            }
        }
    }
    return result;
}

export function format(r: { fileName: string, textSpan: ts.TextSpan }, program: ts.Program) {
    const sourceFile = program.getSourceFile(r.fileName);
    if (!sourceFile) return null;

    const span = r.textSpan;
    const text = sourceFile.text.substring(span.start, span.start + span.length);
    const ctx = extendToFullLines(span, sourceFile.text);
    const contextText = sourceFile.text.substring(ctx.start, ctx.start + ctx.length);

    const start = contextText.indexOf(text);
    const end = start + text.length;
    return contextText.substring(0, start) + "[" + text + "]" + contextText.substring(end);
};

function extendToFullLines(span: ts.TextSpan, str: string): ts.TextSpan {
    const start = str.lastIndexOf("\n", span.start) + 1;
    const end = str.indexOf("\n", span.start + span.length);

    return {
        start,
        length: end - start,
    };
}
