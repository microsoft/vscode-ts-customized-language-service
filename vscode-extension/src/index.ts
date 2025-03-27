import { ExtensionContext } from "vscode";

export class Extension {
	constructor() {
	}

	dispose(): void {
	}
}

export function activate(context: ExtensionContext) {
	context.subscriptions.push(new Extension());
}

export function deactivate() { }
