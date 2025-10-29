
import type * as tsApi from "typescript/lib/tsserverlibrary";

let ts: typeof tsApi;

export function setTsApi(api: typeof tsApi) {
    ts = api;
}

export interface ConditionDiagnostic {
    message: string;
    node: tsApi.Node;
    category: 'warning' | 'hint';
    code?: number;
    conditionType?: 'always-true' | 'always-false';
}

// Diagnostic codes for our custom diagnostics
export const DiagnosticCodes = {
    CONDITION_ALWAYS_TRUE: 90001,
    CONDITION_ALWAYS_FALSE: 90002,
} as const;

// Helper to safely get the intrinsic name of a boolean literal type
function getBooleanLiteralIntrinsicName(type: tsApi.Type): 'true' | 'false' | undefined {
    if (type.flags & ts.TypeFlags.BooleanLiteral) {
        return (type as any).intrinsicName as 'true' | 'false' | undefined;
    }
    return undefined;
}

export function checkConditions(sf: tsApi.SourceFile, program: tsApi.Program): ConditionDiagnostic[] {
    const result: ConditionDiagnostic[] = [];
    const typeChecker = program.getTypeChecker();

    function visit(node: tsApi.Node) {
        // Check if statements
        if (ts.isIfStatement(node)) {
            checkConditionExpression(node.expression);
        }
        
        // Check conditional expressions (ternary operator)
        if (ts.isConditionalExpression(node)) {
            checkConditionExpression(node.condition);
        }

        ts.forEachChild(node, visit);
    }

    function checkConditionExpression(expr: tsApi.Expression) {
        // Try to get the declared type instead of the narrowed type
        let type = typeChecker.getTypeAtLocation(expr);
        
        // If this is an identifier, try to get its declared type from the symbol
        if (ts.isIdentifier(expr)) {
            const symbol = typeChecker.getSymbolAtLocation(expr);
            if (symbol) {
                // Try to get the type from the declaration
                const declarations = symbol.getDeclarations();
                if (declarations && declarations.length > 0) {
                    for (const decl of declarations) {
                        // For variable declarations, parameters, etc.
                        if ((ts.isVariableDeclaration(decl) || ts.isParameter(decl)) && decl.type) {
                            // Get the type from the type annotation
                            let declaredType = typeChecker.getTypeFromTypeNode(decl.type);
                            
                            // If it's a type reference (like MyType), try to expand it
                            if (ts.isTypeReferenceNode(decl.type)) {
                                // Get the aliased type (follow type aliases)
                                const aliasSymbol = typeChecker.getSymbolAtLocation(decl.type.typeName);
                                if (aliasSymbol && aliasSymbol.declarations && aliasSymbol.declarations.length > 0) {
                                    const aliasDecl = aliasSymbol.declarations[0];
                                    if (ts.isTypeAliasDeclaration(aliasDecl) && aliasDecl.type) {
                                        const expandedType = typeChecker.getTypeFromTypeNode(aliasDecl.type);
                                        if (expandedType) {
                                            declaredType = expandedType;
                                        }
                                    }
                                }
                            }
                            
                            if (declaredType) {
                                type = declaredType;
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        // Don't check any or unknown types
        if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            return;
        }
        
        // Get the truthiness and falsiness of the type
        const canBeTruthy = canBeTruthyValue(type);
        const canBeFalsy = canBeFalsyValue(type);
        const isBoolean = isBooleanType(type);

        if (!canBeTruthy && canBeFalsy) {
            // Always false
            result.push({
                message: `This condition will always return 'false'.`,
                node: expr,
                category: 'warning',
                code: DiagnosticCodes.CONDITION_ALWAYS_FALSE,
                conditionType: 'always-false'
            });
        } else if (canBeTruthy && !canBeFalsy) {
            // Always true
            result.push({
                message: `This condition will always return 'true'.`,
                node: expr,
                category: 'warning',
                code: DiagnosticCodes.CONDITION_ALWAYS_TRUE,
                conditionType: 'always-true'
            });
        } else if (!isBoolean && canBeTruthy && canBeFalsy) {
            // Not a boolean but can be both truthy and falsy
            result.push({
                message: `This condition is not a boolean type.`,
                node: expr,
                category: 'hint'
            });
        }
    }

    function isBooleanType(type: tsApi.Type): boolean {
        // Check if the type is exactly 'boolean' (union of true | false)
        if (type.flags & ts.TypeFlags.Boolean) {
            return true;
        }

        // Check if it's a union of true and false
        if (type.flags & ts.TypeFlags.Union) {
            const unionType = type as tsApi.UnionType;
            let hasTrue = false;
            let hasFalse = false;
            let hasOther = false;

            for (const t of unionType.types) {
                const intrinsicName = getBooleanLiteralIntrinsicName(t);
                if (intrinsicName === 'true') {
                    hasTrue = true;
                } else if (intrinsicName === 'false') {
                    hasFalse = true;
                } else {
                    hasOther = true;
                }
            }

            return hasTrue && hasFalse && !hasOther;
        }

        return false;
    }

    function canBeTruthyValue(type: tsApi.Type): boolean {
        // Check for literal boolean types
        const intrinsicName = getBooleanLiteralIntrinsicName(type);
        if (intrinsicName !== undefined) {
            return intrinsicName === 'true';
        }

        // Boolean type can be truthy
        if (type.flags & ts.TypeFlags.Boolean) {
            return true;
        }

        // Check for falsy literal types
        if (type.flags & ts.TypeFlags.Undefined ||
            type.flags & ts.TypeFlags.Null ||
            type.flags & ts.TypeFlags.Void) {
            return false;
        }

        // Check for string literal types
        if (type.flags & ts.TypeFlags.StringLiteral) {
            const value = (type as tsApi.StringLiteralType).value;
            return value !== '';
        }

        // Check for number literal types
        if (type.flags & ts.TypeFlags.NumberLiteral) {
            const value = (type as tsApi.NumberLiteralType).value;
            return value !== 0;
        }

        // Objects (including NonPrimitive which is the 'object' type keyword) are always truthy
        if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) {
            return true;
        }

        // String type can be truthy (non-empty) or falsy (empty)
        // Number type can be truthy (non-zero) or falsy (0)
        // So we need to check more carefully - these types are NOT always truthy
        // They will be caught by the union logic below or default to checking both

        // Union types - can be truthy if any constituent can be truthy
        if (type.flags & ts.TypeFlags.Union) {
            const unionType = type as tsApi.UnionType;
            return unionType.types.some(t => canBeTruthyValue(t));
        }

        // For string and number types without a specific literal, assume they can be both
        // truthy and falsy, so return true here (they can be truthy)
        if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.Number)) {
            return true;
        }

        // Any/unknown types - don't make assumptions
        if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            return true;
        }

        // Default: assume can be truthy for unknown types
        return true;
    }

    function canBeFalsyValue(type: tsApi.Type): boolean {
        // Check for literal boolean types
        const intrinsicName = getBooleanLiteralIntrinsicName(type);
        if (intrinsicName !== undefined) {
            return intrinsicName === 'false';
        }

        // Boolean type can be falsy
        if (type.flags & ts.TypeFlags.Boolean) {
            return true;
        }

        // Falsy values: null, undefined, void
        if (type.flags & ts.TypeFlags.Undefined ||
            type.flags & ts.TypeFlags.Null ||
            type.flags & ts.TypeFlags.Void) {
            return true;
        }

        // Check for string literal types
        if (type.flags & ts.TypeFlags.StringLiteral) {
            const value = (type as tsApi.StringLiteralType).value;
            return value === '';
        }

        // Check for number literal types
        if (type.flags & ts.TypeFlags.NumberLiteral) {
            const value = (type as tsApi.NumberLiteralType).value;
            return value === 0;
        }

        // String type can be empty string (falsy)
        if (type.flags & ts.TypeFlags.String) {
            return true;
        }

        // Number type can be 0 (falsy)
        if (type.flags & ts.TypeFlags.Number) {
            return true;
        }

        // Objects (including NonPrimitive which is the 'object' type keyword) cannot be falsy
        if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) {
            return false;
        }

        // Union types - can be falsy if any constituent can be falsy
        if (type.flags & ts.TypeFlags.Union) {
            const unionType = type as tsApi.UnionType;
            return unionType.types.some(t => canBeFalsyValue(t));
        }

        // Any/unknown types - don't make assumptions
        if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            return true;
        }

        // Default: assume can be falsy for unknown types
        return true;
    }

    visit(sf);
    return result;
}
