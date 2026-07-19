import {
  GatewayError,
  executeRequestSchema,
  type ExecuteRequest,
} from "@ai-gateway/core-contracts";

export function validateExecuteRequest(body: unknown): ExecuteRequest {
  const parsed = executeRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(
      "INVALID_SCHEMA",
      `Malformed ExecuteRequest: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      false,
      { issues: parsed.error.issues },
    );
  }
  if (
    !parsed.data.input.text &&
    (!parsed.data.input.messages || parsed.data.input.messages.length === 0)
  ) {
    throw new GatewayError(
      "INVALID_SCHEMA",
      "ExecuteRequest.input must supply non-empty `text` or `messages`.",
      false,
    );
  }
  return parsed.data;
}
