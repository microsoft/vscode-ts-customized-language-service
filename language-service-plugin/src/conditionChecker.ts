
import type * as tsApi from "typescript/lib/tsserverlibrary";

let ts: typeof tsApi;

export function setTsApi(api: typeof tsApi) {
    ts = api;
}

export interface ConditionDiagnostic {
    message: string;
    node: tsApi.Node;
    category: 'warning' | 'hint';
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
        const type = typeChecker.getTypeAtLocation(expr);
        
        // Get the truthiness and falsiness of the type
        const canBeTruthy = canBeTruthyValue(type);
        const canBeFalsy = canBeFalsyValue(type);
        const isBoolean = isBooleanType(type);

        if (!canBeTruthy && canBeFalsy) {
            // Always false
            result.push({
                message: `This condition will always return 'false'.`,
                node: expr,
                category: 'warning'
            });
        } else if (canBeTruthy && !canBeFalsy) {
            // Always true
            result.push({
                message: `This condition will always return 'true'.`,
                node: expr,
                category: 'warning'
            });
        } else if (!isBoolean && (canBeTruthy || canBeFalsy)) {
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
                if (t.flags & ts.TypeFlags.BooleanLiteral) {
                    const intrinsicName = (t as any).intrinsicName;
                    if (intrinsicName === 'true') {
                        hasTrue = true;
                    } else if (intrinsicName === 'false') {
                        hasFalse = true;
                    }
                } else {
                    hasOther = true;
                }
            }

            return hasTrue && hasFalse && !hasOther;
        }

        return false;
    }

    function canBeTruthyValue(type: tsApi.Type): boolean {
        // Check for literal types
        if (type.flags & ts.TypeFlags.BooleanLiteral) {
            const intrinsicName = (type as any).intrinsicName;
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

        // Check for literal types
        if (type.flags & ts.TypeFlags.StringLiteral) {
            const value = (type as tsApi.StringLiteralType).value;
            return value !== '';
        }

        if (type.flags & ts.TypeFlags.NumberLiteral) {
            const value = (type as tsApi.NumberLiteralType).value;
            return value !== 0;
        }

        // Objects (including NonPrimitive which is the 'object' type keyword), non-empty strings, non-zero numbers are truthy
        if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive | ts.TypeFlags.String | ts.TypeFlags.Number)) {
            return true;
        }

        // Union types - can be truthy if any constituent can be truthy
        if (type.flags & ts.TypeFlags.Union) {
            const unionType = type as tsApi.UnionType;
            return unionType.types.some(t => canBeTruthyValue(t));
        }

        // Unknown types - assume they can be truthy
        return true;
    }

    function canBeFalsyValue(type: tsApi.Type): boolean {
        // Check for literal types
        if (type.flags & ts.TypeFlags.BooleanLiteral) {
            const intrinsicName = (type as any).intrinsicName;
            return intrinsicName === 'false';
        }

        // Boolean type can be falsy
        if (type.flags & ts.TypeFlags.Boolean) {
            return true;
        }

        // Falsy values: null, undefined, void, false, 0, ""
        if (type.flags & ts.TypeFlags.Undefined ||
            type.flags & ts.TypeFlags.Null ||
            type.flags & ts.TypeFlags.Void) {
            return true;
        }

        // Check for literal types
        if (type.flags & ts.TypeFlags.StringLiteral) {
            const value = (type as tsApi.StringLiteralType).value;
            return value === '';
        }

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

        // Objects (including NonPrimitive which is the 'object' type keyword) cannot be falsy (unless null/undefined which are handled above)
        if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) {
            return false;
        }

        // Union types - can be falsy if any constituent can be falsy
        if (type.flags & ts.TypeFlags.Union) {
            const unionType = type as tsApi.UnionType;
            return unionType.types.some(t => canBeFalsyValue(t));
        }

        // Unknown types - assume they can be falsy
        return true;
    }

    visit(sf);
    return result;
}
