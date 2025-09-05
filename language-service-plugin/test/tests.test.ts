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

describe("Go to Definition for Untyped Fields", () => {
	test('Should redirect to first assignment in constructor for untyped field', () => withLanguageService(
		`
			class FooBar {
				public myField; // [1]
				constructor() {
					this.myField = 1; // [2]
				}
			}
			new FooBar().my|Field; // [3]
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDefInfos(ls.getDefinitionAtPosition(sf.fileName, m[0]), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "					this.[myField] = 1; // [2]",
				]
			`);
		}
	));

	test('Should use default behavior for typed field', () => withLanguageService(
		`
			class FooBar {
				public myField: number; // [1]
				constructor() {
					this.myField = 1; // [2]
				}
			}
			new FooBar().my|Field; // [3]
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDefInfos(ls.getDefinitionAtPosition(sf.fileName, m[0]), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "				public [myField]: number; // [1]",
				]
			`);
		}
	));

	test('Should skip assignments in conditional blocks', () => withLanguageService(
		`
			class FooBar {
				public myField; // [1]
				constructor() {
					if (true) {
						this.myField = 1; // not this one
					}
					this.myField = 2; // [2] - should go here
				}
			}
			new FooBar().my|Field; // [3]
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDefInfos(ls.getDefinitionAtPosition(sf.fileName, m[0]), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "					this.[myField] = 2; // [2] - should go here",
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
