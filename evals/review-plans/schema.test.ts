import fs from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schemaPath = path.join(root, "docs/review-plan.schema.json");
const fixtureDir = path.join(root, "evals/review-plans/fixtures");

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

describe("review-plan JSON schema", () => {
  it("validates every committed review-plan fixture", async () => {
    const schema = await readJson<object>(schemaPath);
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const fixtureNames = (await fs.readdir(fixtureDir)).filter((name) => name.endsWith(".review-plan.json"));

    expect(fixtureNames.length).toBeGreaterThan(0);

    for (const fixtureName of fixtureNames) {
      const fixture = await readJson<object>(path.join(fixtureDir, fixtureName));
      const valid = validate(fixture);

      expect(valid, `${fixtureName}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it("requires inline comment severity from the normalized UI vocabulary", async () => {
    const schema = await readJson<object>(schemaPath);
    const fixture = await readJson<Record<string, unknown>>(
      path.join(fixtureDir, "assistant-ui-4025.minimal-good.review-plan.json"),
    );
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const invalid = structuredClone(fixture);

    (
      invalid.slices as Array<{
        inlineComments?: Array<Record<string, unknown>>;
      }>
    )[0].inlineComments![0].severity = "nonblocking";

    expect(validate(invalid)).toBe(false);
    expect(ajv.errorsText(validate.errors)).toContain("should be equal to one of the allowed values");
  });
});
