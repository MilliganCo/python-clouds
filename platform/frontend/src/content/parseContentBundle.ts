import {
  ContentParseError,
  type RawContentBundle,
  type RawTask,
  type RawTheoryBlock,
  type RawTheoryExample,
  type RawTheorySection,
  type RawTopic,
} from "../types/content";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseError(message: string): never {
  throw new ContentParseError(message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    parseError(`Invalid content bundle: ${field} must be a string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    parseError(`Invalid content bundle: ${field} must be a number`);
  }
  return value;
}

function parseTheoryExample(value: unknown, index: number): RawTheoryExample {
  if (!isObject(value)) {
    parseError(`Invalid content bundle: theory.sections[].examples[${index}] must be an object`);
  }
  if ("code" in value && value.code !== undefined && typeof value.code !== "string") {
    parseError(
      `Invalid content bundle: theory.sections[].examples[${index}].code must be a string`,
    );
  }
  return { ...value } as RawTheoryExample;
}

function parseTheorySection(value: unknown, index: number): RawTheorySection {
  if (!isObject(value)) {
    parseError(`Invalid content bundle: theory.sections[${index}] must be an object`);
  }
  const section: RawTheorySection = { ...value };
  if ("title" in value && value.title !== undefined && typeof value.title !== "string") {
    parseError(`Invalid content bundle: theory.sections[${index}].title must be a string`);
  }
  if ("text" in value && value.text !== undefined && typeof value.text !== "string") {
    parseError(`Invalid content bundle: theory.sections[${index}].text must be a string`);
  }
  if ("examples" in value && value.examples !== undefined) {
    if (!Array.isArray(value.examples)) {
      parseError(`Invalid content bundle: theory.sections[${index}].examples must be an array`);
    }
    section.examples = value.examples.map((example, exampleIndex) =>
      parseTheoryExample(example, exampleIndex),
    );
  }
  return section;
}

function parseTheoryBlock(value: unknown): RawTheoryBlock {
  if (!isObject(value)) {
    parseError("Invalid content bundle: theory must be an object");
  }
  const text = requireString(value.text, "theory.text");
  const theory: RawTheoryBlock = { ...value, text };
  if ("sections" in value && value.sections !== undefined) {
    if (!Array.isArray(value.sections)) {
      parseError("Invalid content bundle: theory.sections must be an array");
    }
    theory.sections = value.sections.map((section, index) => parseTheorySection(section, index));
  }
  return theory;
}

function parseTask(value: unknown, index: number): RawTask {
  if (!isObject(value)) {
    parseError(`Invalid content bundle: tasks[${index}] must be an object`);
  }
  const id = requireString(value.id, `tasks[${index}].id`);
  return { ...value, id };
}

function parseTopic(value: unknown, index: number): RawTopic {
  if (!isObject(value)) {
    parseError(`Invalid content bundle: topics[${index}] must be an object`);
  }
  const id = requireNumber(value.id, `topics[${index}].id`);
  const title = requireString(value.title, `topics[${index}].title`);
  const description = requireString(value.description, `topics[${index}].description`);
  const theory = parseTheoryBlock(value.theory);
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    parseError(`Invalid content bundle: topics[${index}].tasks must be a non-empty array`);
  }
  const tasks = value.tasks.map((task, taskIndex) => parseTask(task, taskIndex));
  const level = typeof value.level === "string" ? value.level : "";
  const level_label = typeof value.level_label === "string" ? value.level_label : "";
  return { id, title, level, level_label, description, theory, tasks };
}

export function parseContentBundle(data: unknown): RawContentBundle {
  if (!isObject(data)) {
    parseError("Invalid content bundle: expected object");
  }
  if (data.schema_version !== 2) {
    parseError("Invalid content bundle: unsupported schema_version");
  }
  if (!Array.isArray(data.topics)) {
    parseError("Invalid content bundle: topics must be an array");
  }
  const content_version = requireString(data.content_version, "content_version");
  const content_hash = requireString(data.content_hash, "content_hash");
  const python_runtime = requireString(data.python_runtime, "python_runtime");
  const topics = data.topics.map((topic, index) => parseTopic(topic, index));
  return {
    schema_version: 2,
    content_version,
    content_hash,
    python_runtime,
    topics,
  };
}

export function findRawTopic(bundle: RawContentBundle, topicId: number): RawTopic | null {
  return bundle.topics.find((topic) => topic.id === topicId) ?? null;
}
