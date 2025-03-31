import { describe, expect, test } from 'vitest';
import { normalizeDefInfos, normalizeDiagnostics, normalizeReferencedSymbols, withLanguageService } from "./utils";
import { decorateLanguageService } from "../src/decorateLanguageService";

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
			console.log(Test.foo);
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

describe("Find property initialization issues", () => {
	test('Basic', () => withLanguageService(
		`
			class Test {
				public readonly bar = this.test();

				constructor(
					public readonly foo: string,
				) { }

				test() {
					return this.foo;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "diag: 					return this.[foo];
				-> Parameter property 'foo' is used before its declaration. Usage stack: this.test(...) -> this.foo",
				]
			`);
		}
	));

	test('Basic', () => withLanguageService(
		`
			class Test {
				public readonly bar = (() => { return this.foo; })();

				constructor(
					public readonly foo: string,
				) { }
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram())).toMatchInlineSnapshot(`[]`);
		}
	));
});
