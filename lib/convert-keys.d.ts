/**
 * Convert objectKeys to row_keys, including all child elements.
 * @param target - The target object, array, or primitive value to convert
 * @returns A copy of the target with modified keys
 */
export function toSnakeCaseDeep<T = any>(target: T): T;

/**
 * Convert row_keys to objectKeys.
 * @param target - The target object to convert
 * @returns A copy of the target with modified keys
 */
export function toCamelCase<T extends Record<string, any>>(target: T): Record<string, any>;
