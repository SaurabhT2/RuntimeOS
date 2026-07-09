/**
 * Incrementally parses an SSE byte stream (NIM's hosted API is OpenAI-
 * compatible: `data: {json}\n\n` frames, terminated by a literal
 * `data: [DONE]`) into raw JSON payload strings. Mirrors
 * `@ai-gateway/groq`'s own `sse-parser.ts` — see `openai-compat.ts`'s doc
 * comment for why this is duplicated rather than shared.
 */
export async function* parseSseDataLines(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const payload = extractDataPayload(frame);
        if (payload === undefined) continue;
        if (payload === "[DONE]") return;
        yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractDataPayload(frame: string): string | undefined {
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      return line.slice("data:".length).trim();
    }
  }
  return undefined;
}
