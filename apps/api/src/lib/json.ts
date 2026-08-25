import type { Prisma } from '@prisma/client';

type JsonInputValue = Prisma.InputJsonValue | null;

/**
 * Converts a decoded JSON value into Prisma's JSON input type without casts,
 * mirroring JSON.stringify semantics: `undefined` object properties are
 * dropped, `undefined` array items become null, nested nulls are preserved.
 *
 * Returns undefined when the ROOT value is not representable (top-level
 * null/undefined, non-finite numbers, or exotic objects such as Map/Set/class
 * instances). Plain objects, arrays and primitives are always convertible.
 *
 * Webhook bodies arrive through JSON.parse, so validated payloads only ever
 * contain those shapes; the undefined case is defensive.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  const converted = convertJsonValue(value, true);
  return converted === null ? undefined : converted;
}

function convertJsonValue(value: unknown, isRoot: boolean): JsonInputValue | undefined {
  if (value === undefined || value === null) {
    // Dropped inside objects, null inside arrays (JSON.stringify behavior);
    // at the root it means there is nothing representable.
    return isRoot ? undefined : null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const items: JsonInputValue[] = [];
    for (const item of value) {
      const converted = convertJsonValue(item, false);
      if (converted === undefined) {
        return undefined;
      }
      items.push(converted);
    }
    return items;
  }
  if (typeof value === 'object' && isPlainObject(value)) {
    const entries: Record<string, JsonInputValue> = {};
    for (const [key, property] of Object.entries(value)) {      if (property === undefined) {
        continue;
      }
      const converted = convertJsonValue(property, false);
      if (converted === undefined) {
        return undefined;
      }
      entries[key] = converted;
    }
    return entries;
  }
  return undefined;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  // `constructor === Object` covers literals and `new Object()`; `undefined`
  // covers null-prototype objects. Class instances and built-ins differ.
  const { constructor } = value;
  return constructor === Object || constructor === undefined;
}
