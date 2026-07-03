import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * skill-prompt.ts
 * ---------------
 * The tiny templating engine behind every AI "skill" in this app. Each
 * skill's actual system prompt lives in a `skills/<name>/SKILL.md` file at
 * the repo root (not in a database, not hardcoded in TypeScript) so prompt
 * wording can be tuned without a code change or redeploy. The functions here
 * are how TypeScript reads those markdown files and pulls out just the
 * section it needs.
 */

/**
 * Resolves the on-disk path to a skill's SKILL.md, e.g.
 * skillFile('chart', 'SKILL.md') → <repo-root>/skills/chart/SKILL.md.
 *
 * The `..', '..', '..'` walk is relative to THIS file's own location
 * (nest-app/src/ai/), so it works identically whether this code is running
 * from source (ts-jest/ts-node, __dirname = nest-app/src/ai) or from the
 * compiled build (__dirname = nest-app/dist/ai) — both are 3 levels below
 * the repo root where `skills/` actually lives.
 */
export function skillFile(...segments: string[]): string {
  return path.resolve(__dirname, '..', '..', '..', 'skills', ...segments);
}

/**
 * Extracts the text under one markdown heading (e.g. `## System Instructions`)
 * from a SKILL.md file — everything from just after that heading up to the
 * next heading of the same or shallower level (## stops at the next ## or #,
 * but not at a deeper ###).
 *
 * This lets one SKILL.md file hold multiple named sections (e.g. chart's
 * SKILL.md has both "System Instructions" and "Runtime Prompt") that
 * different parts of the code pull independently, without needing separate
 * files.
 */
export function readMarkdownSection(filePath: string, heading: string): string {
  // Normalize Windows line endings up front so the heading-matching regex
  // below doesn't have to account for a trailing \r.
  const content = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  const target = heading.trim().toLowerCase();

  let start = -1;
  let level = 0; // how many '#' characters the matched heading had

  // Find the line whose heading text matches `heading` (case-insensitive).
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    if (!match) continue;
    if (match[2].trim().toLowerCase() !== target) continue;
    start = i + 1; // content begins on the NEXT line, not the heading itself
    level = match[1].length;
    break;
  }

  if (start === -1) {
    // Fail loudly and immediately at startup (this runs at module-load
    // time, not per-request) rather than silently returning an empty
    // prompt — a typo'd heading name should be caught the moment the app
    // boots, not discovered later as a mysteriously bad LLM response.
    throw new Error(`Markdown section "${heading}" not found in ${filePath}`);
  }

  // Collect every line until we hit another heading at the same depth or
  // shallower (e.g. a "## System Instructions" section stops at the next
  // "##" or "#", but a nested "### Examples" inside it is included).
  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    if (match && match[1].length <= level) break;
    collected.push(lines[i]);
  }

  return collected.join('\n').trim();
}

/**
 * Same as readMarkdownSection, but expects the section to contain a single
 * fenced ```json ...``` code block and parses it. Used for the aggregation
 * skill's "Pipeline Config" section — the forbidden-stage denylist and
 * per-stage validation rules that pipeline.service.ts loads at startup are
 * genuinely defined in that markdown file, not duplicated in TypeScript.
 */
export function readJsonSection<T>(filePath: string, heading: string): T {
  const section = readMarkdownSection(filePath, heading);
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(section);
  if (!match?.[1])
    throw new Error(`No JSON block in "${heading}" section of ${filePath}`);
  return JSON.parse(match[1].trim()) as T;
}

/**
 * Fills `{{PLACEHOLDER}}` tokens in a runtime-prompt template with real
 * values at request time (e.g. {{ROW_COUNT}}, {{SAMPLE_ROWS}}). A
 * placeholder with no matching key in `values` is left untouched rather than
 * replaced with an empty string or throwing — makes a missing/typo'd key
 * visible in the actual LLM input instead of silently vanishing.
 */
export function interpolateTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{\{[A-Z0-9_]+\}\}/g,
    (match) => values[match] ?? match,
  );
}
