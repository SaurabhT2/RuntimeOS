import { z } from "zod";

/**
 * A JSON Schema document (draft-07-compatible subset), used wherever the
 * architecture references `JSONSchema` (§10.3 `constraints.requiredSchema`,
 * §12.2 `responseFormat.schema`) without spelling out a concrete type.
 *
 * This is deliberately a structural, permissive type rather than a full
 * JSON-Schema-draft type system: `core-contracts` only needs to carry the
 * schema opaquely from caller to Policy Engine to provider adapter — it is
 * the provider adapter's structured-output translation layer (architecture
 * §12.1) that interprets the schema, not `core-contracts` itself.
 */
export type JSONSchema = {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema | JSONSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  additionalProperties?: boolean | JSONSchema;
  description?: string;
  [key: string]: unknown;
};

export const jsonSchemaSchema: z.ZodType<JSONSchema> = z.lazy(() =>
  z
    .object({
      type: z.union([z.string(), z.array(z.string())]).optional(),
      properties: z.record(jsonSchemaSchema).optional(),
      items: z.union([jsonSchemaSchema, z.array(jsonSchemaSchema)]).optional(),
      required: z.array(z.string()).optional(),
      enum: z.array(z.unknown()).optional(),
      const: z.unknown().optional(),
      additionalProperties: z.union([z.boolean(), jsonSchemaSchema]).optional(),
      description: z.string().optional(),
    })
    .catchall(z.unknown()),
);
