import type * as ts from "typescript/lib/tsserverlibrary";
import { decorateLanguageService } from "./decorateLanguageService";

export default function init(modules: { typescript: typeof ts }) {
	return {
		create(info: ts.server.PluginCreateInfo): ts.LanguageService {
			return decorateLanguageService(modules.typescript, info.languageService);
		},
	};
};
