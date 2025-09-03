class Test {
	constructor() {
		console.log("test");
	}
}

new Test();

function f(data: any) {
}

f(Test);

// Demo of the new untyped field feature
class FooBar {
	public myField; // [1] - untyped field declaration
	public typedField: number; // typed field declaration
	
	constructor() {
		if (Math.random() > 0.5) {
			this.myField = "conditional assignment"; // this should be ignored
		}
		this.myField = 1; // [2] - first top-level assignment (should redirect here)
		this.typedField = 42; // assignment to typed field
	}
}

// Go to definition on myField should redirect to the assignment in constructor
new FooBar().myField; // [3] - should go to [2], not [1]

// Go to definition on typedField should go to the field declaration (default behavior)
new FooBar().typedField; // should go to typed field declaration