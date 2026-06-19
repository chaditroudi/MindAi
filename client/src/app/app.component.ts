import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { interval, of, Subject } from 'rxjs';
import { map, startWith, switchMap, takeUntil } from 'rxjs/operators';
import { AnalyticsApiService, ApiError } from './analytics-api.service';
import { AnalyticsStateService } from './analytics-state.service';
import { ChartRenderService } from './chart-render.service';
import type {
  ModeKey, PromptExample, WidgetSpec,
  AnalyticsResponse, DashboardResponse, InquiryResponse, ReportResponse,
  ConversationMessage, MessageResult, SavedResultSummary,
} from './app.types';

const INTENT_MAP: Record<ModeKey, 'dashboard' | 'report' | 'general_question'> = {
  dashboard: 'dashboard',
  report:    'report',
  inquiry:   'general_question',
};

const MODE_META: Record<ModeKey, { label: string; hint: string }> = {
  dashboard: { label: 'Dashboard', hint: 'Charts and tables from your data' },
  report:    { label: 'Report',    hint: 'Structured analytical narrative' },
  inquiry:   { label: 'Inquiry',   hint: 'Direct answer to a data question' },
};

const WIDGET_TYPE_LABELS: Record<string, string> = {
  table:                'Table',
  kpi_card:             'KPI',
  line_chart:           'Trend',
  area_chart:           'Area',
  multi_line_chart:     'Multi-line',
  bar_chart:            'Bars',
  horizontal_bar_chart: 'Ranking',
  grouped_bar_chart:    'Grouped',
  stacked_bar_chart:    'Stacked',
  donut_chart:          'Share',
  scatter_plot:         'Scatter',
  gauge_chart:          'Gauge',
  funnel_chart:         'Funnel',
  radar_chart:          'Radar',
  heatmap:              'Heatmap',
};

type WidgetDisplayKind = 'chart' | 'kpi' | 'table' | 'unknown';

@Component({
  selector:    'app-root',
  standalone:  true,
  imports:     [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls:   ['./app.component.css'],
})
export class AppComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChildren('chartHost') private chartHosts!: QueryList<ElementRef<HTMLDivElement>>;

  readonly st           = inject(AnalyticsStateService);
  private readonly api    = inject(AnalyticsApiService);
  private readonly charts = inject(ChartRenderService);

  private readonly destroy$      = new Subject<void>();
  private readonly initedWidgets = new Set<string>();
  private timerStart             = 0;

  readonly state$   = this.st.state$;
  readonly modeMeta = MODE_META;
  readonly modes    = ['dashboard', 'report', 'inquiry'] as const;

  readonly elapsed$ = this.st.phase$.pipe(
    switchMap(phase =>
      phase === 'loading'
        ? interval(200).pipe(startWith(0), map(() => `${((Date.now() - this.timerStart) / 1000).toFixed(1)}s`))
        : of(null),
    ),
    takeUntil(this.destroy$),
  );

  ngOnInit(): void {
    let userId = localStorage.getItem('mind_user_id') ?? '';
    if (!userId) {
      userId = crypto.randomUUID();
      localStorage.setItem('mind_user_id', userId);
    }
    const hasKey = localStorage.getItem('mind_has_key') === '1';
    // Start with modal hidden — checkGlobalKey decides whether to show it
    this.st.patch({ userId, hasKey, showKeyModal: false });
    void this.loadMeta();
    void this.loadSessions();
    void this.loadSavedResults();
    void this.loadMemories();
    void this.checkGlobalKey();
  }

  ngAfterViewChecked(): void {
    // Init any chart hosts that haven't been initialized yet
    this.chartHosts.forEach(ref => {
      const el  = ref.nativeElement;
      const key = el.getAttribute('data-widget-id');
      if (!key || this.initedWidgets.has(key)) return;

      const [msgId, widgetId] = key.split('|');
      const msg    = this.st.snap.messages.find(m => m.messageId === msgId);
      const widget = msg?.result?.dashboardSpec?.widgets.find(w => w.id === widgetId);
      if (!widget?.option) return;

      this.charts.initWidget(el, widget);
      this.initedWidgets.add(key);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.charts.disposeAll();
  }

  // saved results actions

  savedIds = new Set<string>(); // messageIds already saved this session

  async saveResult(msg: ConversationMessage): Promise<void> {
    const { userId } = this.st.snap;
    if (!msg.result || !msg.messageId) return;
    const title = (msg.prompt ?? msg.result.type ?? 'Result').slice(0, 120);
    const intentMap: Record<string, ModeKey> = {
      dashboard: 'dashboard', report: 'report',
      inquiry: 'inquiry', general_question: 'inquiry',
    };
    const intent = intentMap[msg.intent ?? ''] ?? 'inquiry';
    try {
      const { id } = await this.api.saveResult(userId, {
        title,
        prompt: msg.prompt ?? '',
        intent,
        result: msg.result as MessageResult,
      });
      this.savedIds.add(msg.messageId);
      const fresh = await this.api.listSavedResults(userId);
      this.st.patch({ savedResults: fresh, sidebarOpen: true, sidebarTab: 'saved' });
      void id;
    } catch (err) {
      console.error('saveResult failed:', err);
    }
  }

  async openSaved(item: SavedResultSummary): Promise<void> {
    const { userId } = this.st.snap;
    try {
      const detail = await this.api.getSavedResult(userId, item.id);
      this.st.patch({ viewingSaved: detail });
    } catch { /* non-critical */ }
  }

  closeSaved(): void {
    this.st.patch({ viewingSaved: null });
  }

  async deleteSaved(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    const { userId } = this.st.snap;
    try {
      await this.api.deleteSavedResult(userId, id);
      this.st.patch({ savedResults: this.st.snap.savedResults.filter(r => r.id !== id) });
      if (this.st.snap.viewingSaved?.id === id) this.st.patch({ viewingSaved: null });
    } catch { /* non-critical */ }
  }

  // api key management

  async saveApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('gsk_')) {
      this.st.patch({
        keyRejected: true,
        keyErrorText: 'Keys must start with "gsk_". Get yours at console.groq.com',
      });
      return;
    }
    const { userId } = this.st.snap;
    try {
      await this.api.saveKey(userId, trimmed);
      localStorage.setItem('mind_has_key', '1');
      this.st.patch({ hasKey: true, keyRejected: false, keyErrorText: '', showKeyModal: false });
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Failed to verify the API key. Please try again.';
      this.st.patch({ keyRejected: true, keyErrorText: message });
    }
  }

  handleInvalidKey(): void {
    localStorage.removeItem('mind_has_key');
    // Delete the bad per-user key so subsequent requests fall back to the global key
    void this.api.deleteKey(this.st.snap.userId).catch(() => {});
    void this.api.getProvider().then(({ hasGlobalKey }) => {
      if (hasGlobalKey) {
        // Global key is available — silently recover, no modal needed
        this.st.patch({ hasKey: true, keyRejected: false, phase: 'idle' });
      } else {
        this.st.patch({ hasKey: false, keyRejected: true, showKeyModal: true, phase: 'idle' });
      }
    }).catch(() => {
      this.st.patch({ hasKey: false, keyRejected: true, showKeyModal: true, phase: 'idle' });
    });
  }

  async clearApiKey(): Promise<void> {
    const { userId } = this.st.snap;
    try {
      await this.api.deleteKey(userId);
    } catch { /* best-effort */ }
    localStorage.removeItem('mind_has_key');
    this.st.patch({ hasKey: false, showKeyModal: true });
  }

  // mode + session controls

  setIntent(intent: ModeKey): void {
    if (this.st.snap.phase === 'loading') return;
    this.st.patch({ intent });
  }

  newSession(): void {
    this.charts.disposeAll();
    this.initedWidgets.clear();
    this.st.newSession();
  }

  toggleSidebar(): void {
    this.st.patch({ sidebarOpen: !this.st.snap.sidebarOpen });
  }

  async loadSession(sessionId: string): Promise<void> {
    if (this.st.snap.phase === 'loading') return;
    try {
      const { messages } = await this.api.getSession(sessionId);
      this.charts.disposeAll();
      this.initedWidgets.clear();
      this.st.patch({
        sessionId,
        messages: messages as ConversationMessage[],
        phase: 'idle',
        errorText: '',
      });
    } catch { /* non-critical */ }
  }

  async deleteSession(sessionId: string, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await this.api.deleteSession(sessionId);
      const sessions = this.st.snap.sessions.filter(s => s.sessionId !== sessionId);
      this.st.patch({ sessions });
      if (this.st.snap.sessionId === sessionId) this.newSession();
    } catch { /* non-critical */ }
  }

  useExample(ex: PromptExample): void {
    if (this.st.snap.phase === 'loading') return;
    this.st.patch({ prompt: ex.prompt });
  }

  handlePromptEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    void this.run();
  }


  async run(): Promise<void> {
    const { prompt, intent, phase, sessionId, userId, hasKey } = this.st.snap;
    if (!prompt.trim() || phase === 'loading') return;
    if (!hasKey) { this.st.patch({ showKeyModal: true }); return; }

    // For report intent, pause and ask the user which format they want.
    if (intent === 'report') {
      const tempId = `temp-${Date.now()}`;
      this.st.patch({
        pendingSuggestion: true,
        pendingPrompt:     prompt.trim(),
        prompt:            '',
        messages: [
          ...this.st.snap.messages,
          { messageId: tempId, role: 'user', prompt: prompt.trim(), intent },
        ],
      });
      return;
    }

    this.timerStart = Date.now();
    this.st.setLoading(intent);

    // Optimistically add user message
    const tempId = `temp-${Date.now()}`;
    this.st.patch({
      messages: [
        ...this.st.snap.messages,
        { messageId: tempId, role: 'user', prompt: prompt.trim(), intent },
      ],
    });

    try {
      const data = await this.api.runAnalytics({
        prompt:    prompt.trim(),
        intent:    INTENT_MAP[intent],
        sessionId: sessionId,
      }, userId);

      const durationMs = Date.now() - this.timerStart;

      const currentMessages = this.st.snap.messages;
      const assistantMsg    = this.buildAssistantMessage(data, durationMs, prompt.trim());

      this.st.patch({
        phase:     'done',
        durationMs,
        sessionId: data.sessionId,
        messages:  [...currentMessages, assistantMsg],
        prompt:    '',
      });

      void this.loadSessions();
      setTimeout(() => void this.loadMemories(), 3000);

    } catch (err) {
      this.st.patch({ messages: this.st.snap.messages.filter(m => m.messageId !== tempId) });
      if (err instanceof ApiError && err.code === 'INVALID_API_KEY') {
        this.handleInvalidKey();
      } else {
        this.st.setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    }
  }

  async chooseReportFormat(choice: 'report' | 'chart' | 'both'): Promise<void> {
    const { pendingPrompt, sessionId, userId, hasKey } = this.st.snap;
    if (!hasKey) { this.st.patch({ showKeyModal: true }); return; }
    this.st.patch({ pendingSuggestion: false });
    this.timerStart = Date.now();
    this.st.patch({ phase: 'loading' });

    try {
      if (choice === 'both') {
        const [dashData, reportData] = await Promise.all([
          this.api.runAnalytics({ prompt: pendingPrompt, intent: 'dashboard', sessionId }, userId),
          this.api.runAnalytics({ prompt: pendingPrompt, intent: 'report',    sessionId }, userId),
        ]);
        const durationMs = Date.now() - this.timerStart;
        const combined: ConversationMessage = {
          messageId: reportData.messageId,
          role:      'assistant',
          result: {
            type:           'report+chart',
            dashboardSpec:  (dashData as DashboardResponse).chart,
            reportSections: (reportData as ReportResponse).reportSections ?? [],
            durationMs,
          },
        };
        this.st.patch({
          phase: 'done', durationMs,
          sessionId: reportData.sessionId,
          messages:  [...this.st.snap.messages, combined],
        });
      } else {
        const apiIntent = choice === 'chart' ? 'dashboard' : 'report';
        const data      = await this.api.runAnalytics({ prompt: pendingPrompt, intent: apiIntent, sessionId }, userId);
        const durationMs = Date.now() - this.timerStart;
        this.st.patch({
          phase: 'done', durationMs,
          sessionId: data.sessionId,
          messages: [...this.st.snap.messages, this.buildAssistantMessage(data, durationMs, pendingPrompt)],
        });
      }
      void this.loadSessions();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_API_KEY') {
        this.handleInvalidKey();
      } else {
        this.st.setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    }
  }

  // widget display helpers

  isChartWidget(w: WidgetSpec): boolean {
    return this.widgetDisplayKind(w) === 'chart';
  }

  isKpiWidget(w: WidgetSpec): boolean {
    return this.widgetDisplayKind(w) === 'kpi';
  }

  isTableWidget(w: WidgetSpec): boolean {
    return this.widgetDisplayKind(w) === 'table';
  }

  trackById(_: number, w: WidgetSpec): string { return w.id; }

  trackByMsgId(_: number, m: ConversationMessage): string { return m.messageId; }

  widgetTypeLabel(widget: WidgetSpec): string {
    return WIDGET_TYPE_LABELS[widget.type]
      ?? widget.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  widgetKey(msgId: string, widgetId: string): string {
    return `${msgId}|${widgetId}`;
  }

  formatDate(date: string | Date): string {
    const d    = new Date(date);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000)    return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  intentLabel(intent: string): string {
    switch (intent) {
      case 'dashboard': return 'Dashboard';
      case 'report': return 'Report';
      case 'inquiry': return 'Inquiry';
      default: return intent;
    }
  }

  // private

  private buildAssistantMessage(data: AnalyticsResponse, durationMs: number, prompt: string): ConversationMessage {
    const base = { messageId: data.messageId, role: 'assistant' as const, prompt };

    if (data.intent === 'dashboard' && 'chart' in data) {
      return { ...base, intent: 'dashboard', result: { type: 'dashboard', dashboardSpec: (data as DashboardResponse).chart, durationMs } };
    }
    if (data.intent === 'report') {
      return { ...base, intent: 'report', result: { type: 'report', reportSections: (data as ReportResponse).reportSections ?? [], durationMs } };
    }
    return { ...base, intent: 'inquiry', result: { type: 'inquiry', summary: (data as InquiryResponse).summary ?? '', durationMs } };
  }

  private async checkGlobalKey(): Promise<void> {
    try {
      const { hasGlobalKey } = await this.api.getProvider();
      if (hasGlobalKey) {
        // Server key available — user never needs to enter a personal key
        this.st.patch({ hasKey: true, showKeyModal: false });
      } else if (!this.st.snap.hasKey) {
        // No global key and no saved user key — need to prompt
        this.st.patch({ showKeyModal: true });
      }
    } catch {
      // Server unreachable — fall back to localStorage state
      if (!this.st.snap.hasKey) {
        this.st.patch({ showKeyModal: true });
      }
    }
  }

  private async loadSessions(): Promise<void> {
    try {
      const sessions = await this.api.listSessions();
      this.st.patch({ sessions });
    } catch { /* non-critical */ }
  }

  async loadSavedResults(): Promise<void> {
    const { userId } = this.st.snap;
    if (!userId) return;
    try {
      const items = await this.api.listSavedResults(userId);
      this.st.patch({ savedResults: items });
    } catch { /* non-critical */ }
  }

  async loadMemories(): Promise<void> {
    const { userId } = this.st.snap;
    if (!userId) return;
    try {
      const memories = await this.api.listMemories(userId);
      this.st.patch({ memories });
    } catch { /* non-critical */ }
  }

  async clearMemories(): Promise<void> {
    const { userId } = this.st.snap;
    if (!userId) return;
    try {
      await this.api.clearMemories(userId);
      this.st.patch({ memories: [] });
    } catch { /* non-critical */ }
  }

  memoryTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      goal:       '🎯',
      insight:    '💡',
      preference: '⭐',
      context:    '📌',
      decision:   '✅',
    };
    return icons[type] ?? '🧠';
  }

  memoryTypeColor(type: string): string {
    const colors: Record<string, string> = {
      goal:       'memory-goal',
      insight:    'memory-insight',
      preference: 'memory-preference',
      context:    'memory-context',
      decision:   'memory-decision',
    };
    return colors[type] ?? '';
  }

  private async loadMeta(): Promise<void> {
    try {
      const data    = await this.api.getMeta();
      const examples: Record<ModeKey, PromptExample[]> = { dashboard: [], report: [], inquiry: [] };
      for (const mode of data.modes) {
        examples[mode.intent] = (mode.prompts ?? []).map(p => ({ ...p, tag: MODE_META[mode.intent]?.label }));
      }
      this.st.patch({ examples });
    } catch { /* non-critical */ }
  }

  private widgetDisplayKind(widget: WidgetSpec): WidgetDisplayKind {
    if (this.hasChartOption(widget)) return 'chart';
    if (typeof widget.value === 'number') return 'kpi';
    if (widget.type === 'kpi_card') return 'kpi';
    if (Array.isArray(widget.columns) || Array.isArray(widget.rows)) return 'table';
    if (widget.type === 'table') return 'table';
    return 'unknown';
  }

  private hasChartOption(widget: WidgetSpec): boolean {
    return typeof widget.option === 'object' && widget.option !== null;
  }
}
