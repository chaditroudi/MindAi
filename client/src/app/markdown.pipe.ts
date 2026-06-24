import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Renders the three markdown patterns defined in skills/report/SKILL.md:
//   **bold**  →  <strong>
//   - item    →  <ul><li>   (Key Findings and Recommendations sections)
//   prose     →  <p>        (Overview, Breakdown, Trends sections)

@Pipe({ name: 'md', standalone: true })
export class MarkdownPipe implements PipeTransform {
  constructor(private san: DomSanitizer) {}

  transform(text: string): SafeHtml {
    return this.san.bypassSecurityTrustHtml(this.toHtml(text ?? ''));
  }

  private toHtml(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let inList = false;
    let paraLines: string[] = [];

    const flushPara = () => {
      if (!paraLines.length) return;
      out.push(`<p>${this.bold(paraLines.join(' '))}</p>`);
      paraLines = [];
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      // Only `- ` prefix per the skill spec
      const isBullet = /^- /.test(line.trimStart());

      if (isBullet) {
        flushPara();
        if (!inList) { out.push('<ul>'); inList = true; }
        const item = line.trimStart().slice(2); // strip "- "
        out.push(`<li>${this.bold(item)}</li>`);
      } else if (!line.trim()) {
        if (inList) { out.push('</ul>'); inList = false; }
        flushPara();
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        paraLines.push(line.trim());
      }
    }

    if (inList) out.push('</ul>');
    flushPara();
    return out.join('');
  }

  // Converts **text** → <strong>text</strong>
  private bold(text: string): string {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
}
