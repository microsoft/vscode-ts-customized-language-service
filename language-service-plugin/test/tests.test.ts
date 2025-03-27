import { describe, expect, test } from 'vitest';
import { withLanguageService } from "./utils";
import { decorateLanguageService } from "../src/decorateLanguageService";
import { DefinitionInfo, Program, ReferencedSymbol, ReferenceEntry, TextSpan } from 'typescript';

describe("Remove Duplicate Definitions", () => {
	test('Basic', () => withLanguageService(
		`
			class Test {
				constructor() {
					console.log("test");
				}
			}

			new Te|st();
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDefInfos(ls.getDefinitionAtPosition(sf.fileName, m[0]), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "				[constructor() {
									console.log("test");
								}]",
				]
			`);
		}
	));
});

describe("Find Indirect Constructors", () => {
	test('Basic', () => withLanguageService(
		`
			class Test {
				cons|tructor() {
					console.log("test");
				}
			}

			function f(obj: any) {
			}

			f(Test);
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeReferencedSymbols(ls.findReferences(sf.fileName, m[0]), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "def:			class [Test] {",
				  "ref: 				[constructor]() {",
				  "ref: 			f([Test]);",
				]
			`);
		}
	));
});

function normalizeDefInfos(defInfos: readonly (DefinitionInfo | ReferenceEntry)[] | undefined, program: Program | undefined) {
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

function normalizeReferencedSymbols(refs: ReferencedSymbol[] | undefined, program: Program | undefined) {
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

function format(r: { fileName: string, textSpan: TextSpan }, program: Program) {
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

function extendToFullLines(span: TextSpan, str: string): TextSpan {
	const start = str.lastIndexOf("\n", span.start) + 1;
	const end = str.indexOf("\n", span.start + span.length);

	return {
		start,
		length: end - start,
	};
}
