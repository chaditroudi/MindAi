import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

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
      out.push(`<p>${this.inline(paraLines.join(' '))}</p>`);
      paraLines = [];
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      const isList = /^[-•]\s/.test(line.trimStart());

      if (isList) {
        flushPara();
        if (!inList) { out.push('<ul>'); inList = true; }
        const item = line.trimStart().replace(/^[-•]\s/, '');
        out.push(`<li>${this.inline(item)}</li>`);
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

  private inline(text: string): string {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
}
