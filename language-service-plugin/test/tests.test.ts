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

	test('Should go to constructor when class used as function argument', () => withLanguageService(
		`
			class TextModelChangeTracker {
				constructor(
					private readonly modifiedModel: string,
					private readonly state: string,
					telemetryInfo: string,
					entryId: string,
				) {
					console.log("constructor");
				}
			}

			function createInstance<T>(ctor: new (...args: any[]) => T, ...args: any[]): T {
				return new ctor(...args);
			}

			createInstance(TextModelChange|Tracker, "model", "state", "info", "id");
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDefInfos(ls.getDefinitionAtPosition(sf.fileName, m[0]), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "				[constructor(
									private readonly modifiedModel: string,
									private readonly state: string,
									telemetryInfo: string,
									entryId: string,
								) {
									console.log("constructor");
								}]",
				]
			`);
		}
	));

	test('Should go to class when not used as function argument', () => withLanguageService(
		`
			class TextModelChangeTracker {
				constructor(
					private readonly modifiedModel: string,
				) {
					console.log("constructor");
				}
			}

			const someVariable: TextModelChange|Tracker;
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			expect(normalizeDefInfos(ls.getDefinitionAtPosition(sf.fileName, m[0]), languageService.getProgram())).toMatchInlineSnapshot(`
				[
				  "			class [TextModelChangeTracker] {",
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

describe("Condition Checker", () => {
	test('Always true - literal true', () => withLanguageService(
		`
			if (true) {
				const x = 1;
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			// Filter to only our condition checker diagnostics
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 			if ([true]) {
				-> This condition will always return 'true'.",
				]
			`);
		}
	));

	test('Always false - literal false', () => withLanguageService(
		`
			if (false) {
				const x = 1;
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 			if ([false]) {
				-> This condition will always return 'false'.",
				]
			`);
		}
	));

	test('No warning - boolean type', () => withLanguageService(
		`
			function test(x: boolean) {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`[]`);
		}
	));

	test('Always true - object type', () => withLanguageService(
		`
			function test(x: object) {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 				if ([x]) {
				-> This condition will always return 'true'.",
				]
			`);
		}
	));

	test('Hint - object | null union type', () => withLanguageService(
		`
			type MyType = {} | null;
			declare const x: MyType;
			if (x) {
				const y = 1;
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			// With proper union type, should get a hint (not boolean) rather than warning (always true)
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 			if ([x]) {
				-> This condition is not a boolean type.",
				]
			`);
		}
	));

	test('Hint - object | string union type', () => withLanguageService(
		`
			declare const x: object | string;
			if (x) {
				const y = 1;
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			// object | string can be both truthy (object, non-empty string) and falsy (empty string)
			// Should get a hint that it's not boolean
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 			if ([x]) {
				-> This condition is not a boolean type.",
				]
			`);
		}
	));

	test('Hint - string | null union', () => withLanguageService(
		`
			type MyType = string | null;
			declare const x: MyType;
			if (x) {
				const y = 1;
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			// String can be empty (falsy) or non-empty (truthy), plus null (falsy)
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 			if ([x]) {
				-> This condition is not a boolean type.",
				]
			`);
		}
	));

	test('Hint - interface type', () => withLanguageService(
		`
			interface IFoobar {
				foo: string;
			}
			function test(x: IFoobar) {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 				if ([x]) {
				-> This condition will always return 'true'.",
				]
			`);
		}
	));

	test('Ternary - always true', () => withLanguageService(
		`
			const y = true ? 1 : 2;
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 			const y = [true] ? 1 : 2;
				-> This condition will always return 'true'.",
				]
			`);
		}
	));

	test('Ternary - always false', () => withLanguageService(
		`
			const y = false ? 1 : 2;
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 			const y = [false] ? 1 : 2;
				-> This condition will always return 'false'.",
				]
			`);
		}
	));

	test('Hint - string type (can be empty or not)', () => withLanguageService(
		`
			function test(x: string) {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 				if ([x]) {
				-> This condition is not a boolean type.",
				]
			`);
		}
	));

	test('Always true - non-empty string literal', () => withLanguageService(
		`
			function test(x: "hello") {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 				if ([x]) {
				-> This condition will always return 'true'.",
				]
			`);
		}
	));

	test('Always false - empty string literal', () => withLanguageService(
		`
			function test(x: "") {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 				if ([x]) {
				-> This condition will always return 'false'.",
				]
			`);
		}
	));

	test('Always false - number literal 0', () => withLanguageService(
		`
			function test(x: 0) {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 				if ([x]) {
				-> This condition will always return 'false'.",
				]
			`);
		}
	));

	test('Always true - number literal non-zero', () => withLanguageService(
		`
			function test(x: 42) {
				if (x) {
					const y = 1;
				}
			}
		`,
		(ts, languageService, sf, m) => {
			const ls = decorateLanguageService(ts, languageService)

			const diags = normalizeDiagnostics(ls.getSemanticDiagnostics(sf.fileName), languageService.getProgram());
			const filtered = diags?.filter(d => d.includes("This condition"));
			expect(filtered).toMatchInlineSnapshot(`
				[
				  "diag: 				if ([x]) {
				-> This condition will always return 'true'.",
				]
			`);
		}
	));
});
