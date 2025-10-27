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
        const content = this.files.get(fileName);
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
        return this.files.has(path);
    }
}

function stripMarkers(src: string): { stripped: string; markers: number[] } {
    let stripped = "";
    const markers = new Array<number>();
    let i = 0;
    let first = true;
    for (const part of src.split("|")) {
        if (first) {
            first = false;
        } else {
            markers.push(i);
        }
        stripped += part;
        i += part.length;
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
