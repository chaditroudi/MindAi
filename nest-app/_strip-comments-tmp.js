const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);

const KEEP_PATTERNS = [
  /^\/\/\/\s*<reference/, // triple-slash directives
  /@ts-(ignore|expect-error|nocheck|check)\b/, // ts compiler directives
  /eslint-disable/,
  /eslint-enable/,
  /^#!/, // shebang
  /prettier-ignore/,
  /istanbul ignore/,
  /webpackChunkName/,
  /webpackIgnore/,
];

function shouldKeep(commentText) {
  return KEEP_PATTERNS.some((re) => re.test(commentText));
}

function stripComments(text) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /*skipTrivia*/ false,
    ts.LanguageVariant.Standard,
    text,
  );
  const ranges = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const start = scanner.getTokenPos();
      const end = scanner.getTextPos();
      const commentText = text.slice(start, end);
      if (!shouldKeep(commentText)) {
        ranges.push([start, end]);
      }
    }
    kind = scanner.scan();
  }

  if (ranges.length === 0) return text;

  let result = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [start, end] = ranges[i];
    result = result.slice(0, start) + result.slice(end);
  }

  // Clean up now-empty lines that only contained a removed comment,
  // and trim trailing whitespace left behind by trailing comments.
  const lines = result.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  const cleaned = [];
  for (const line of lines) {
    const isBlank = line.trim() === '';
    const prevBlank = cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '';
    if (isBlank && prevBlank) continue; // collapse multiple blank lines
    cleaned.push(line);
  }
  return cleaned.join('\n');
}

for (const file of files) {
  const abs = path.resolve(file);
  const original = fs.readFileSync(abs, 'utf8');
  const stripped = stripComments(original);
  if (stripped !== original) {
    fs.writeFileSync(abs, stripped, 'utf8');
    console.log('updated', file);
  }
}
