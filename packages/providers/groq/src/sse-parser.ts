/**
 * Incrementally parses an SSE byte stream (Groq/OpenAI-compatible:
 * `data: {json}\n\n` frames, terminated by a literal `data: [DONE]`) into
 * raw JSON payload strings, buffering correctly across arbitrary chunk
 * boundaries (a single `read()` may split a frame anywhere, including
 * mid-line).
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
      // SSE frames are separated by a blank line ("\n\n"); a frame may
      // itself contain multiple `\n`-terminated fields, but this adapter
      // only ever sends/receives single-field `data:` frames.
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
