import type { IntentKind } from '../types';

const DASHBOARD = [
  /\b(chart|graph|plot|visuali[sz]e?|dashboard|widget)\b/i,
  /\b(pie|bar|donut|funnel|scatter|heatmap|histogram|gauge|treemap)\b/i,
  /\b(trend|distribution|breakdown|ranking)\b/i,
  /\bby\s+(month|year|quarter|week|day|date|period)\b/i,
  /\bover\s+time\b/i,
  /\bper\s+(month|year|quarter|week|day)\b/i,
  /\b(compar(e|ing|ison)|versus|vs\.?)\b/i,
  /\btop\s+\d+\b/i,
  /\b(monthly|yearly|quarterly|weekly|daily)\b/i,
];

const REPORT = [
  /\b(write|generate|create|draft|produce)\b.{0,40}\b(report|analysis|summary|document)\b/i,
  /\b(detailed|comprehensive|in-depth|full)\s+(report|analysis|summary|overview)\b/i,
  /\bwrite\s+(a\s+|an\s+|the\s+)?(report|summary|analysis)\b/i,
  /\bsummariz(e|ing)\s+.{0,40}\b(performance|results|data|quarter|year|month)\b/i,
];

export function detectIntent(prompt: string): IntentKind {
  if (DASHBOARD.some(r => r.test(prompt))) return 'dashboard';
  if (REPORT.some(r => r.test(prompt)))    return 'report';
  return 'general_question';
}
