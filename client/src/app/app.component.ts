import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as echarts from 'echarts';
import { AnalyticsApiService } from './analytics-api.service';
import type {
  AnalyticsResponse,
  DashboardResponse,
  InquiryResponse,
  ModeKey,
  PromptExample,
  ReportResponse,
  ReportSection,
  Stage,
} from './app.types';

const MODE: Record<ModeKey, { hint: string; tag: string }> = {
  dashboard: { hint: 'ينشئ مخططاً بيانياً تفاعلياً من بيانات MongoDB.', tag: 'رسم' },
  report: { hint: 'ينشئ تقريراً تحليلياً موجزاً من بيانات MongoDB.', tag: 'تقرير' },
  inquiry: { hint: 'يجلب السجلات المطابقة ثم يلخصها في إجابة واضحة.', tag: 'بحث' },
};

const INTENT_MAP: Record<ModeKey, 'dashboard' | 'report' | 'general_question'> = {
  dashboard: 'dashboard',
  report: 'report',
  inquiry: 'general_question',
};

const STAGES: Record<ModeKey, Stage[]> = {
  dashboard: [
    { label: 'تخطيط الطلب', detail: 'المشرف يبني خطة البيانات', at: 0 },
    { label: 'قراءة MongoDB', detail: 'تنفيذ aggregation pipeline', at: 2800 },
    { label: 'بناء المخطط', detail: 'وكيل الرسم يختار النوع والمحاور', at: 7000 },
    { label: 'تجهيز العرض', detail: 'إرجاع النتيجة', at: 10000 },
  ],
  report: [
    { label: 'تخطيط التقرير', detail: 'المشرف يحدد البيانات المطلوبة', at: 0 },
    { label: 'قراءة MongoDB', detail: 'تنفيذ الاستعلام', at: 2800 },
    { label: 'كتابة التقرير', detail: 'وكيل الكاتب يصيغ الأقسام', at: 7500 },
    { label: 'تجهيز العرض', detail: 'إرجاع النتيجة', at: 12000 },
  ],
  inquiry: [
    { label: 'تخطيط البحث', detail: 'المشرف يحدد السجلات المطلوبة', at: 0 },
    { label: 'جلب السجلات', detail: 'MongoDB يطبق المرشحات', at: 2200 },
    { label: 'صياغة الإجابة', detail: 'وكيل الكاتب يلخص النتيجة', at: 5500 },
  ],
};

const CHART_LABELS: Record<string, string> = {
  bar: 'أعمدة',
  horizontalBar: 'أعمدة أفقية',
  line: 'خط',
  donut: 'حلقي',
  scatter: 'مبعثر',
  histogram: 'توزيع',
  map: 'خريطة',
  table: 'جدول',
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('chartHost') private readonly chartHost?: ElementRef<HTMLDivElement>;

  private readonly api = inject(AnalyticsApiService);

  currentMode: ModeKey = 'dashboard';
  prompt = '';
  selectedStore?: string;
  examples: Record<ModeKey, PromptExample[]> = { dashboard: [], report: [], inquiry: [] };
  displayState: 'placeholder' | 'chart' | 'text' = 'placeholder';
  reportSections: ReportSection[] = [];
  summaryText = '';
  errorMessage = '';
  chartTitle = '';
  chartTypeLabel = '';
  isRunning = false;
  statusVisible = false;
  statusLabel = 'جار التشغيل';
  statusDetail = 'تهيئة الطلب';
  statusTone: 'default' | 'ok' | 'err' = 'default';
  statusText = 'جاهز';
  durationText = '0 ms';
  elapsedText = '0s';
  workspaceSubtitle = 'اختر مثالاً أو اكتب طلباً للبدء.';
  progressWidth = 0;

  private chart?: echarts.ECharts;
  private resizeHandler = () => this.chart?.resize();
  private progressTimer?: number;
  private hideStatusTimer?: number;
  private startedAt = 0;

  get modeHint(): string {
    return MODE[this.currentMode].hint;
  }

  get currentExamples(): PromptExample[] {
    return this.examples[this.currentMode] ?? [];
  }

  get sourceText(): string {
    return this.selectedStore ? `مصدر: ${this.selectedStore}` : 'مصدر: تلقائي';
  }

  ngOnInit(): void {
    this.resetView();
    void this.loadMeta();
  }

  ngAfterViewInit(): void {
    if (!this.chartHost) {
      return;
    }

    this.chart = echarts.init(this.chartHost.nativeElement);
    window.addEventListener('resize', this.resizeHandler);
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.clearTimers();
    this.chart?.dispose();
  }

  setMode(mode: ModeKey): void {
    if (this.isRunning || this.currentMode === mode) {
      return;
    }

    this.currentMode = mode;
    this.selectedStore = undefined;
    this.resetView();
  }

  clearSelectedStore(): void {
    this.selectedStore = undefined;
  }

  onPromptKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.run();
    }
  }

  async useExample(example: PromptExample): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.prompt = example.prompt;
    this.selectedStore = example.dataStoreName;
    await this.run();
  }

  async run(): Promise<void> {
    const prompt = this.prompt.trim();
    if (!prompt || this.isRunning) {
      return;
    }

    this.startRun();

    try {
      this.startedAt = Date.now();
      const data = await this.api.runAnalytics({
        prompt,
        intent: INTENT_MAP[this.currentMode],
        dataStoreName: this.selectedStore,
      });

      this.finishRun(true);
      this.render(data);
      this.durationText = `${(Date.now() - this.startedAt).toLocaleString()} ms`;
      this.workspaceSubtitle = this.resultSubtitle(data);
    } catch (error) {
      this.finishRun(false);
      this.showError(error instanceof Error ? error.message : 'فشل الطلب');
    } finally {
      this.resetControls();
    }
  }

  private async loadMeta(): Promise<void> {
    try {
      const data = await this.api.getMeta();
      const nextExamples: Record<ModeKey, PromptExample[]> = { dashboard: [], report: [], inquiry: [] };

      for (const mode of data.modes) {
        nextExamples[mode.intent] = (mode.prompts ?? []).map((prompt) => ({
          ...prompt,
          tag: MODE[mode.intent]?.tag,
        }));
      }

      this.examples = nextExamples;
    } catch {
      this.examples = { dashboard: [], report: [], inquiry: [] };
    }
  }

  private render(data: AnalyticsResponse): void {
    if (data.intent === 'dashboard' && 'chart' in data) {
      this.renderChart(data);
      return;
    }

    this.chart?.clear();
    this.chartTitle = '';
    this.chartTypeLabel = '';
    this.displayState = 'text';

    if (data.intent === 'report') {
      this.reportSections = (data as ReportResponse).reportSections ?? [];
      this.summaryText = '';
      this.errorMessage = '';
      return;
    }

    this.reportSections = [];
    this.summaryText = (data as InquiryResponse).summary ?? '';
    this.errorMessage = '';
  }

  private renderChart(data: DashboardResponse): void {
    this.reportSections = [];
    this.summaryText = '';
    this.errorMessage = '';
    this.displayState = 'chart';
    this.chartTitle = data.chart.title || 'الرسم البياني';
    this.chartTypeLabel = CHART_LABELS[data.chart.chartType ?? ''] || data.chart.chartType || 'رسم';
    this.chart?.clear();
    this.chart?.setOption(data.chart.option, true);
    window.setTimeout(() => this.chart?.resize(), 0);
  }

  private showError(message: string): void {
    this.chart?.clear();
    this.reportSections = [];
    this.summaryText = '';
    this.errorMessage = message;
    this.chartTitle = '';
    this.chartTypeLabel = '';
    this.displayState = 'text';
  }

  private resultSubtitle(data: AnalyticsResponse): string {
    const source = this.selectedStore || 'مصدر تلقائي';
    if (data.intent === 'dashboard') {
      return `${source} · رسم بياني`;
    }
    if (data.intent === 'report') {
      return `${source} · تقرير تحليلي`;
    }
    return `${source} · ملخص`;
  }

  private startRun(): void {
    const stages = STAGES[this.currentMode];
    this.clearTimers();
    this.startedAt = Date.now();
    this.isRunning = true;
    this.statusVisible = true;
    this.statusTone = 'default';
    this.statusText = 'قيد التشغيل';
    this.durationText = '0 ms';
    this.elapsedText = '0s';
    this.workspaceSubtitle = 'جار تنفيذ الطلب عبر الوكلاء...';
    this.displayState = 'placeholder';
    this.reportSections = [];
    this.summaryText = '';
    this.errorMessage = '';
    this.chartTitle = '';
    this.chartTypeLabel = '';
    this.updateStage(stages);
    this.progressTimer = window.setInterval(() => this.updateStage(stages), 500);
  }

  private updateStage(stages: Stage[]): void {
    const elapsedMs = Date.now() - this.startedAt;
    let currentIndex = 0;
    for (let index = stages.length - 1; index >= 0; index -= 1) {
      if (elapsedMs >= stages[index].at) {
        currentIndex = index;
        break;
      }
    }
    const currentStage = stages[currentIndex];
    const nextAt = stages[currentIndex + 1]?.at ?? currentStage.at + 9000;
    const fraction = Math.min(0.9, (elapsedMs - currentStage.at) / Math.max(1, nextAt - currentStage.at));
    const percent = ((currentIndex + fraction) / stages.length) * 100;

    this.statusLabel = currentStage.label;
    this.statusDetail = currentStage.detail;
    this.elapsedText = `${Math.floor(elapsedMs / 1000)}s`;
    this.progressWidth = Math.min(92, Math.max(4, percent));
  }

  private finishRun(ok: boolean): void {
    this.clearIntervalTimer();
    this.progressWidth = 100;
    this.statusLabel = ok ? 'اكتملت النتيجة' : 'فشل الطلب';
    this.statusDetail = ok ? 'تم تجهيز العرض' : 'راجع سجل الخادم';
    this.statusTone = ok ? 'ok' : 'err';
    this.statusText = ok ? 'اكتمل' : 'فشل';
  }

  private resetControls(): void {
    this.isRunning = false;
    this.hideStatusTimer = window.setTimeout(() => {
      this.statusVisible = false;
      this.progressWidth = 0;
    }, 800);
  }

  private resetView(): void {
    this.chart?.clear();
    this.clearTimers();
    this.reportSections = [];
    this.summaryText = '';
    this.errorMessage = '';
    this.chartTitle = '';
    this.chartTypeLabel = '';
    this.displayState = 'placeholder';
    this.statusVisible = false;
    this.statusLabel = 'جار التشغيل';
    this.statusDetail = 'تهيئة الطلب';
    this.workspaceSubtitle = 'اختر مثالاً أو اكتب طلباً للبدء.';
    this.statusTone = 'default';
    this.statusText = 'جاهز';
    this.durationText = '0 ms';
    this.elapsedText = '0s';
    this.progressWidth = 0;
  }

  private clearTimers(): void {
    this.clearIntervalTimer();
    if (this.hideStatusTimer) {
      window.clearTimeout(this.hideStatusTimer);
      this.hideStatusTimer = undefined;
    }
  }

  private clearIntervalTimer(): void {
    if (this.progressTimer) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = undefined;
    }
  }
}
