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
import { MarkdownPipe } from './markdown.pipe';
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
  imports:     [CommonModule, FormsModule, MarkdownPipe],
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

    this.st.patch({ userId });
    void this.loadSettings();
    void this.loadMeta();
    void this.loadSessions();
    void this.loadSavedResults();
    void this.loadMemories();
    void this.loadMemoryConfig();
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

  private async loadSettings(): Promise<void> {
    const { userId } = this.st.snap;
    try {
      const res = await this.api.getSettings(userId);
      if (res.configured) {
        this.st.patch({
          hasKey: true, showKeyModal: false,
          provider: res.provider ?? '',
          selectedModel: res.model ?? '',
        });
      } else {
        this.st.patch({ hasKey: false, showKeyModal: true });
      }
    } catch {
      this.st.patch({ hasKey: false, showKeyModal: true });
    }
  }

  async saveApiKey(key: string, provider: string, model: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed || !provider || !model) return;

    try {
      await this.api.saveSettings(this.st.snap.userId, { apiKey: trimmed, provider, model });
      this.st.patch({
        hasKey: true, keyRejected: false, keyErrorText: '', showKeyModal: false,
        provider, selectedModel: model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings. Please try again.';
      this.st.patch({ keyRejected: true, keyErrorText: message });
    }
  }

  handleInvalidKey(): void {
    void this.api.deleteSettings(this.st.snap.userId).catch(() => undefined);
    this.st.patch({
      hasKey: false,
      keyRejected: true,
      keyErrorText: 'Your API key was rejected or revoked. Please enter a new one.',
      showKeyModal: true,
      phase: 'idle',
      provider: '',
      selectedModel: '',
    });
  }

  clearApiKey(): void {
    void this.api.deleteSettings(this.st.snap.userId).catch(() => undefined);
    this.st.patch({ hasKey: false, showKeyModal: true, provider: '', selectedModel: '' });
  }

  readonly PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
    groq: [
      { value: 'llama-3.3-70b-versatile',         label: 'Llama 3.3 70B Versatile (recommended)' },
      { value: 'llama-3.1-70b-versatile',         label: 'Llama 3.1 70B Versatile' },
      { value: 'llama-3.1-8b-instant',            label: 'Llama 3.1 8B Instant (fast)' },
      { value: 'llama3-70b-8192',                 label: 'Llama 3 70B' },
      { value: 'llama3-8b-8192',                  label: 'Llama 3 8B' },
      { value: 'llama-3.2-90b-vision-preview',    label: 'Llama 3.2 90B Vision' },
      { value: 'llama-3.2-11b-vision-preview',    label: 'Llama 3.2 11B Vision' },
      { value: 'llama-3.2-3b-preview',            label: 'Llama 3.2 3B' },
      { value: 'llama-3.2-1b-preview',            label: 'Llama 3.2 1B' },
      { value: 'mixtral-8x7b-32768',              label: 'Mixtral 8x7B' },
      { value: 'gemma2-9b-it',                    label: 'Gemma 2 9B' },
      { value: 'gemma-7b-it',                     label: 'Gemma 7B' },
      { value: 'qwen-qwq-32b',                    label: 'Qwen QwQ 32B' },
      { value: 'deepseek-r1-distill-llama-70b',   label: 'DeepSeek R1 Distill Llama 70B' },
      { value: 'compound-beta',                   label: 'Compound Beta' },
      { value: 'compound-beta-mini',              label: 'Compound Beta Mini' },
    ],
    openai: [
      { value: 'gpt-4o',              label: 'GPT-4o (recommended)' },
      { value: 'gpt-4o-mini',         label: 'GPT-4o Mini (fast)' },
      { value: 'chatgpt-4o-latest',   label: 'ChatGPT-4o Latest' },
      { value: 'gpt-4-turbo',         label: 'GPT-4 Turbo' },
      { value: 'gpt-4',               label: 'GPT-4' },
      { value: 'gpt-3.5-turbo',       label: 'GPT-3.5 Turbo' },
      { value: 'o1',                  label: 'o1' },
      { value: 'o1-mini',             label: 'o1 Mini' },
      { value: 'o3-mini',             label: 'o3 Mini' },
      { value: 'o3',                  label: 'o3' },
    ],
    anthropic: [
      { value: 'claude-opus-4-8',              label: 'Claude Opus 4.8 (most capable)' },
      { value: 'claude-sonnet-4-6',            label: 'Claude Sonnet 4.6 (recommended)' },
      { value: 'claude-haiku-4-5-20251001',    label: 'Claude Haiku 4.5 (fast)' },
      { value: 'claude-3-5-sonnet-20241022',   label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-5-haiku-20241022',    label: 'Claude 3.5 Haiku' },
      { value: 'claude-3-opus-20240229',       label: 'Claude 3 Opus' },
      { value: 'claude-3-sonnet-20240229',     label: 'Claude 3 Sonnet' },
      { value: 'claude-3-haiku-20240307',      label: 'Claude 3 Haiku' },
    ],
    google: [
      { value: 'gemini-2.0-flash',             label: 'Gemini 2.0 Flash (recommended)' },
      { value: 'gemini-2.0-flash-exp',         label: 'Gemini 2.0 Flash Exp' },
      { value: 'gemini-2.0-flash-lite',        label: 'Gemini 2.0 Flash Lite (fast)' },
      { value: 'gemini-1.5-pro',               label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash',             label: 'Gemini 1.5 Flash' },
      { value: 'gemini-1.5-flash-8b',          label: 'Gemini 1.5 Flash 8B' },
      { value: 'gemini-1.0-pro',               label: 'Gemini 1.0 Pro' },
    ],
  };

  modelsForProvider(provider: string): { value: string; label: string }[] {
    return this.PROVIDER_MODELS[provider] ?? [];
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
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      this.st.patch({
        sessionId,
        messages: messages as ConversationMessage[],
        phase: 'idle',
        errorText: '',
        prompt: lastUserMsg?.prompt ?? this.st.snap.prompt,
      });
    } catch (err) {
      this.st.patch({
        phase: 'error',
        errorText: err instanceof Error ? err.message : 'Failed to load session history.',
      });
    }
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

  async loadMemoryConfig(): Promise<void> {
    try {
      const { extractionEnabled } = await this.api.getMemoryConfig();
      this.st.patch({ memoryExtractionEnabled: extractionEnabled });
    } catch { /* non-critical — default stays true */ }
  }

  async toggleMemoryExtraction(): Promise<void> {
    const next = !this.st.snap.memoryExtractionEnabled;
    // Optimistically update the UI before the server responds
    this.st.patch({ memoryExtractionEnabled: next });
    try {
      await this.api.setMemoryConfig(next);
    } catch {
      // Revert if the server call failed
      this.st.patch({ memoryExtractionEnabled: !next });
    }
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
