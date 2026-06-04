/**
 * Skill composition utilities.
 *
 * Skills are reusable instruction modules — domain rules and best practices
 * that agents load at initialisation time. They augment an agent's reasoning
 * without replacing any runtime execution logic (tools, workflows, pipelines).
 *
 * Usage:
 *   import { composeWithSkills } from '../skills/compose.js';
 *   import { chartSelectionSkill } from '../skills/chart-selection/index.js';
 *
 *   instructions: composeWithSkills(BASE_INSTRUCTIONS, [chartSelectionSkill])
 */

// ─── Skill type ───────────────────────────────────────────────────────────────

/**
 * An AgentSkill is a reusable block of domain guidance that gets injected
 * into one or more agent system prompts.
 *
 * Rules for writing skill instructions:
 *  - Be directive and specific ("Always …", "Never …", "When X → do Y").
 *  - Avoid prose explanations — agents read instructions as rules, not essays.
 *  - Do not duplicate logic already enforced by tools or schemas.
 *  - Keep each skill focused on a single domain of expertise.
 */
export interface AgentSkill {
  /** Unique kebab-case identifier. */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** One-line summary shown in logs and registries. */
  readonly description: string;
  /**
   * Agent names (from Agent.name) that should load this skill.
   * Informational only — not enforced programmatically.
   */
  readonly applicableAgents: string[];
  /** The instruction text appended to the agent's base instructions. */
  readonly instructions: string;
  /** Semantic version of the skill. Bump minor for additions, patch for fixes. */
  readonly version: string;
  /** Free-form tags for filtering and documentation. */
  readonly tags: string[];
}

// ─── Composition ─────────────────────────────────────────────────────────────

/**
 * Appends skill instruction blocks to a base instruction string.
 *
 * Each skill is rendered as a clearly-delimited section so the agent can
 * identify skill boundaries when reading its system prompt.
 *
 * Returns the base instructions unchanged when no skills are provided.
 */
export function composeWithSkills(
  baseInstructions: string,
  skills: AgentSkill[],
): string {
  if (skills.length === 0) return baseInstructions;

  const header =
    '\n\n' +
    '═══════════════════════════════════════════════════════\n' +
    'SKILL MODULES\n' +
    'The following skills extend this agent with additional domain guidance.\n' +
    'Apply these rules alongside the base instructions above.\n' +
    '═══════════════════════════════════════════════════════';

  const blocks = skills
    .map(
      (skill) =>
        `\n\n[SKILL: ${skill.name.toUpperCase()} — v${skill.version}]\n` +
        skill.instructions.trim(),
    )
    .join('');

  return baseInstructions.trimEnd() + header + blocks;
}

/**
 * Returns a single skill's instructions wrapped in its section header.
 * Useful when composing skill text programmatically outside an agent.
 */
export function renderSkillBlock(skill: AgentSkill): string {
  return (
    `[SKILL: ${skill.name.toUpperCase()} — v${skill.version}]\n` +
    skill.instructions.trim()
  );
}
