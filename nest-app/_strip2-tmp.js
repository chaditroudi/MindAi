const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);

const KEEP_PATTERNS = [
  /^\/\/\/\s*<reference/,
  /@ts-(ignore|expect-error|nocheck|check)\b/,
  /eslint-disable/,
  /eslint-enable/,
  /^#!/,
  /prettier-ignore/,
  /istanbul ignore/,
  /webpackChunkName/,
  /webpackIgnore/,
];

function shouldKeep(commentText) {
  return KEEP_PATTERNS.some((re) => re.test(commentText));
}

function collectCommentRanges(sourceFile, fullText) {
  const ranges = [];
  const seen = new Set();

  function addRangesAt(pos) {
    if (pos === undefined) return;
    const leading = ts.getLeadingCommentRanges(fullText, pos);
    if (leading) {
      for (const r of leading) {
        const key = r.pos + ':' + r.end;
        if (!seen.has(key)) {
          seen.add(key);
          ranges.push(r);
        }
      }
    }
  }

  function visit(node) {
    addRangesAt(node.getFullStart());
    node.forEachChild(visit);
  }

  visit(sourceFile);
  addRangesAt(sourceFile.endOfFileToken.getFullStart());

  return ranges;
}

function stripComments(text, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const ranges = collectCommentRanges(sourceFile, text);
  const toRemove = ranges
    .filter((r) => !shouldKeep(text.slice(r.pos, r.end)))
    .sort((a, b) => a.pos - b.pos);

  if (toRemove.length === 0) return text;

  let result = text;
  for (let i = toRemove.length - 1; i >= 0; i--) {
    const { pos, end } = toRemove[i];
    result = result.slice(0, pos) + result.slice(end);
  }

  const lines = result.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  const cleaned = [];
  for (const line of lines) {
    const isBlank = line.trim() === '';
    const prevBlank = cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '';
    if (isBlank && prevBlank) continue;
    cleaned.push(line);
  }
  return cleaned.join('\n');
}

for (const file of files) {
  const abs = path.resolve(file);
  const original = fs.readFileSync(abs, 'utf8');
  const stripped = stripComments(original, abs);
  if (stripped !== original) {
    fs.writeFileSync(abs, stripped, 'utf8');
    console.log('updated', file);
  }
}
