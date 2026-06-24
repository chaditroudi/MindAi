import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ name: 'md', standalone: true })
export class MarkdownPipe implements PipeTransform {
  constructor(private san: DomSanitizer) {}

  transform(text: string): SafeHtml {
    return this.san.bypassSecurityTrustHtml(this.toHtml(text ?? ''));
  }

  private toHtml(text: string): string {
    // Normalize: split inline "• item • item" into separate lines
    const normalized = text.replace(/([^\n])\s*•\s+/g, '$1\n• ');
    const lines = normalized.split('\n');
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
      const trimmed = line.trimStart();
      // Accept both "- " (spec) and "• " (LLM default)
      const isBullet = /^[-•]\s/.test(trimmed);

      if (isBullet) {
        flushPara();
        if (!inList) { out.push('<ul>'); inList = true; }
        const item = trimmed.replace(/^[-•]\s/, '');
        out.push(`<li>${this.bold(item)}</li>`);
      } else if (!trimmed) {
        if (inList) { out.push('</ul>'); inList = false; }
        flushPara();
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        paraLines.push(trimmed);
      }
    }

    if (inList) out.push('</ul>');
    flushPara();
    return out.join('');
  }

  private bold(text: string): string {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
}
