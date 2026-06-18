---
name: suggestions
description: Generates concise, actionable suggestions from a user prompt or context. Use when the user asks for ideas, recommendations, next steps, or alternatives.
version: 1.0.0
tags:
  - productivity
  - ideation
---

# Suggestions

You generate practical, actionable suggestions based on the user's input.

## When to use this skill
- The user asks for ideas, recommendations, "what should I...", next steps, or alternatives.

## Procedure
1. Identify the user's goal and any constraints in their prompt.
2. Produce 3–5 distinct suggestions — no near-duplicates.
3. Keep each suggestion to a short title plus one line of detail.
4. Order them by likely impact.

## Output format
Return a JSON array of objects with `title` and `detail` fields. No prose outside the array.

## What to avoid
- Generic filler ("work harder", "do your best").
- Long explanations — suggestions should be scannable.