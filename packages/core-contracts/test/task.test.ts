import { describe, expect, it } from "vitest";
import { KNOWN_TASK_TYPES, isKnownTaskType, taskTypeSchema } from "../src/task.js";

describe("KNOWN_TASK_TYPES / isKnownTaskType", () => {
  it.each(KNOWN_TASK_TYPES)("recognizes %s as a known task type", (taskType) => {
    expect(isKnownTaskType(taskType)).toBe(true);
  });

  it("returns false for a custom/unregistered task type, without treating it as invalid", () => {
    expect(isKnownTaskType("invoice_line_item_extraction")).toBe(false);
  });
});

describe("taskTypeSchema", () => {
  it("accepts any non-empty string, including custom task types", () => {
    expect(taskTypeSchema.safeParse("summarization").success).toBe(true);
    expect(taskTypeSchema.safeParse("some_custom_task").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(taskTypeSchema.safeParse("").success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(taskTypeSchema.safeParse(42).success).toBe(false);
    expect(taskTypeSchema.safeParse(null).success).toBe(false);
  });
});
