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
  AgentConfigResponse, AgentEntry, AgentStatus, ConnectionInfo,
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
type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'mistral'
  | 'together'
  | 'perplexity';
type ModelOption = { id: string; label: string };
type ProviderOption = { id: ProviderId; label: string };

const STATIC_PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'openai',     label: 'OpenAI' },
  { id: 'anthropic',  label: 'Anthropic' },
  { id: 'google',     label: 'Google Gemini' },
  { id: 'groq',       label: 'Groq' },
  { id: 'mistral',    label: 'Mistral' },
  { id: 'together',   label: 'Together AI' },
  { id: 'perplexity', label: 'Perplexity' },
];

const STATIC_MODELS_BY_PROVIDER: Record<ProviderId, ModelOption[]> = {
  openai: [
    { id: 'gpt-4o',      label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'o1',          label: 'o1' },
    { id: 'o1-mini',     label: 'o1 Mini' },
    { id: 'o3',          label: 'o3' },
    { id: 'o3-mini',     label: 'o3 Mini' },
  ],
  anthropic: [
    { id: 'claude-opus-4-8',            label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229',     label: 'Claude 3 Opus' },
  ],
  google: [
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile' },
    { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B Instant' },
    { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it',            label: 'Gemma 2 9B' },
  ],
  mistral: [
    { id: 'mistral-large-latest',  label: 'Mistral Large' },
    { id: 'mistral-medium-latest', label: 'Mistral Medium' },
    { id: 'mistral-small-latest',  label: 'Mistral Small' },
    { id: 'codestral-latest',      label: 'Codestral' },
    { id: 'open-mistral-nemo',     label: 'Mistral Nemo' },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
    { id: 'meta-llama/Llama-3.1-70B-Instruct-Turbo', label: 'Llama 3.1 70B Turbo' },
    { id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo',  label: 'Llama 3.1 8B Turbo' },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',    label: 'Mixtral 8x7B' },
    { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',         label: 'Qwen 2.5 72B Turbo' },
  ],
  perplexity: [
    { id: 'sonar-pro',           label: 'Sonar Pro' },
    { id: 'sonar',               label: 'Sonar' },
    { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro' },
    { id: 'sonar-reasoning',     label: 'Sonar Reasoning' },
  ],
};

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

  // Agent connection test state
  agentTestStatus: 'idle' | 'testing' | 'ok' | 'error' = 'idle';
  agentTestError = '';

  // Agent config editing state
  configSaving = false;
  configError  = '';
  agentDraft:  AgentEntry[] = [];
  memoryLimitDraft = 50;
  newAgent: AgentEntry = this.createEmptyAgent();
  showAddAgent = false;
  editingAgentIndex: number | null = null;

  private readonly destroy$      = new Subject<void>();
  private readonly initedWidgets = new Set<string>();
  private timerStart             = 0;

  readonly state$   = this.st.state$;
  readonly modeMeta = MODE_META;
  readonly modes    = ['dashboard', 'report', 'inquiry'] as const;
  readonly providerOptions = STATIC_PROVIDER_OPTIONS;

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
    void this.loadAgentConfig();
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
      await this.api.saveResult(userId, {
        title,
        prompt: msg.prompt ?? '',
        intent,
        result: msg.result as MessageResult,
      });
      this.savedIds.add(msg.messageId);
      const fresh = await this.api.listSavedResults(userId);
      this.st.patch({ savedResults: fresh, sidebarOpen: true, sidebarTab: 'saved' });
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
          hasKey:             true,
          provider:           this.normalizeProvider(res.provider),
          selectedModel:      this.effectiveModel(res.model),
          responseTokenLimit: this.coercePositiveInt(
            res.responseTokenLimit ?? res.inputTokenLimit,
            4_000,
          ),
        });
      }
      // hasKey via agents is resolved in loadAgentConfig()
    } catch { /* non-critical */ }
  }

  handleInvalidKey(): void {
    void this.api.deleteSettings(this.st.snap.userId).catch(() => undefined);
    this.st.patch({ hasKey: false, phase: 'idle', provider: '', selectedModel: '' });
    this.openConfigAgents();
  }

  openConfigAgents(): void {
    this.showAddAgent = false;
    this.editingAgentIndex = null;
    this.st.patch({ sidebarOpen: true, sidebarTab: 'config' });
    void this.loadAgentConfig();
  }

  async testAgentConnection(): Promise<void> {
    const { provider, model, apiKey } = this.newAgent;
    if (!apiKey || !provider || !model) return;
    this.agentTestStatus = 'testing';
    this.agentTestError  = '';
    try {
      await this.api.validateSettings({ apiKey, provider, model });
      this.agentTestStatus = 'ok';
    } catch (err) {
      this.agentTestStatus = 'error';
      this.agentTestError  = err instanceof Error ? err.message : 'Validation failed. Please try again.';
    }
  }

  normalizeProvider(provider: string | null | undefined): string {
    return (provider ?? '').trim().toLowerCase();
  }

  effectiveProvider(provider: string | null | undefined): string {
    return this.normalizeProvider(provider);
  }

  effectiveModel(model: string | null | undefined): string {
    return (model ?? '').trim();
  }

  apiKeyPlaceholder(): string {
    return 'Paste the API key for this provider';
  }

  onProviderChange(provider: string): void {
    this.st.patch({ provider: this.normalizeProvider(provider), selectedModel: '' });
  }

  onSettingsModelChange(model: string): void {
    this.st.patch({ selectedModel: model });
  }

  onResponseTokenLimitChange(value: number | string): void {
    this.st.patch({ responseTokenLimit: this.coercePositiveInt(value, 4_000) });
  }

  onNewAgentProviderChange(provider: string): void {
    this.newAgent.provider = this.normalizeProvider(provider);
    this.newAgent.model    = '';
  }

  get availableModels(): ModelOption[] {
    return this.modelsForProvider(this.st.snap.provider, this.st.snap.selectedModel);
  }

  get availableNewAgentModels(): ModelOption[] {
    return this.modelsForProvider(this.newAgent.provider, this.newAgent.model);
  }

  get isEditingAgent(): boolean {
    return this.editingAgentIndex !== null;
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
        messages:            messages as ConversationMessage[],
        phase:               'idle',
        errorText:           '',
        prompt:              lastUserMsg?.prompt ?? this.st.snap.prompt,
        pendingSuggestion:   false,
        pendingPrompt:       '',
        pendingTokenConfirm: null,
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
    if (!hasKey) { this.openConfigAgents(); return; }

    // For report intent, pause and ask the user which format they want.
    if (intent === 'report') {
      const tempId = `temp-${Date.now()}`;
      this.pendingReportTempId = tempId;
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
        provider:  this.normalizeProvider(data.connection?.provider) || this.st.snap.provider,
        selectedModel: this.effectiveModel(data.connection?.model) || this.st.snap.selectedModel,
      });

      const postConf = this.buildPostCallConfirm(data, prompt.trim(), intent);
      if (postConf) this.st.patch({ pendingTokenConfirm: postConf });

      void this.loadSessions();
      setTimeout(() => void this.loadMemories(), 3000);

    } catch (err) {
      this.st.patch({ messages: this.st.snap.messages.filter(m => m.messageId !== tempId) });
      // Always refresh agent status after a failed call — backend may have marked agents expired/idle
      void this.loadAgentConfig();
      if (err instanceof ApiError && err.code === 'INVALID_API_KEY') {
        this.handleInvalidKey();
      } else if (err instanceof ApiError && err.code === 'NO_ACTIVE_CONNECTION') {
        this.st.patch({ phase: 'idle' });
        this.openConfigAgents();
      } else if (err instanceof ApiError && (
        err.code === 'TOKEN_LIMIT_TOO_LOW'
        || err.code === 'INPUT_TOKEN_LIMIT_TOO_LOW'
        || err.code === 'MEMORY_TOKEN_LIMIT_TOO_LOW'
      )) {
        this.st.patch({
          phase: 'idle',
          pendingTokenConfirm: this.buildTokenConfirm(err, prompt.trim(), intent),
        });
      } else {
        this.st.setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    }
  }

  private buildTokenConfirm(err: ApiError, prompt: string, intent: ModeKey) {
    const isMemory   = err.code === 'MEMORY_TOKEN_LIMIT_TOO_LOW';
    const isInput    = err.code === 'INPUT_TOKEN_LIMIT_TOO_LOW';
    const agentId = typeof err.data?.['agentId'] === 'string'
      ? (err.data['agentId'] as string)
      : this.activeAgent()?.id;
    const memoryCurrent = agentId
      ? this.agentDraft.find(agent => agent.id === agentId)?.memoryTokenLimit
      : undefined;
    const current    = Number(err.data?.['currentLimit']) || (
      isMemory ? (memoryCurrent ?? 4_000) : isInput ? 8_000 : this.effectiveOutputTokenLimit()
    );
    const suggested  = Number(err.data?.['suggestedLimit']) || Math.min(128_000, current * 2);
    return {
      prompt, intent, agentId,
      memoryFix:      isMemory ? { current, suggested, used: Number(err.data?.['usedTokens']) || undefined } : undefined,
      outputFix:      !isMemory && !isInput ? { current, suggested } : undefined,
      inputFix:       !isMemory && isInput ? { current, suggested, used: Number(err.data?.['usedTokens']) || undefined } : undefined,
      retryAfterApply: true,
    };
  }

  private buildPostCallConfirm(data: AnalyticsResponse, prompt: string, intent: ModeKey) {
    if (!data.tokenLimitExceeded && !data.inputLimitWarning) return null;
    return {
      prompt, intent,
      agentId:         data.connection?.agentId ?? this.activeAgent()?.id,
      outputFix:       data.outputLimitWarning
        ? { current: data.outputLimitWarning.currentLimit, suggested: data.outputLimitWarning.suggestedLimit }
        : undefined,
      inputFix:        data.inputLimitWarning
        ? {
            current: data.inputLimitWarning.currentLimit,
            suggested: data.inputLimitWarning.suggestedLimit,
            used: data.inputLimitWarning.usedTokens,
          }
        : undefined,
      retryAfterApply: !!data.tokenLimitExceeded,
    };
  }

  async chooseReportFormat(choice: 'report' | 'chart' | 'both'): Promise<void> {
    const { pendingPrompt, sessionId, userId, hasKey } = this.st.snap;
    if (!hasKey) { this.openConfigAgents(); return; }
    const reportTempId = this.pendingReportTempId;
    this.pendingReportTempId = null;
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
          messageId:          reportData.messageId,
          role:               'assistant',
          prompt:             pendingPrompt,
          intent:             'report',
          inputTokens:        (dashData.inputTokens ?? 0) + (reportData.inputTokens ?? 0),
          outputTokens:       (dashData.outputTokens ?? 0) + (reportData.outputTokens ?? 0),
          connection:         reportData.connection ?? dashData.connection,
          tokenLimitExceeded: dashData.tokenLimitExceeded || reportData.tokenLimitExceeded,
          outputTokenLimit:   reportData.connection?.outputTokenLimit
            ?? dashData.connection?.outputTokenLimit
            ?? this.effectiveOutputTokenLimit(),
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
          provider:  this.normalizeProvider((reportData.connection ?? dashData.connection)?.provider) || this.st.snap.provider,
          selectedModel: this.effectiveModel((reportData.connection ?? dashData.connection)?.model) || this.st.snap.selectedModel,
        });
        const mergedData = {
          tokenLimitExceeded: combined.tokenLimitExceeded,
          outputLimitWarning: dashData.outputLimitWarning ?? reportData.outputLimitWarning,
          inputLimitWarning:  dashData.inputLimitWarning  ?? reportData.inputLimitWarning,
        } as AnalyticsResponse;
        const postConf = this.buildPostCallConfirm(mergedData, pendingPrompt, 'report');
        if (postConf) this.st.patch({ pendingTokenConfirm: postConf });
      } else {
        const apiIntent = choice === 'chart' ? 'dashboard' : 'report';
        const data      = await this.api.runAnalytics({ prompt: pendingPrompt, intent: apiIntent, sessionId }, userId);
        const durationMs = Date.now() - this.timerStart;
        this.st.patch({
          phase: 'done', durationMs,
          sessionId: data.sessionId,
          messages: [...this.st.snap.messages, this.buildAssistantMessage(data, durationMs, pendingPrompt)],
          provider: this.normalizeProvider(data.connection?.provider) || this.st.snap.provider,
          selectedModel: this.effectiveModel(data.connection?.model) || this.st.snap.selectedModel,
        });
        const postConf = this.buildPostCallConfirm(data, pendingPrompt, 'report');
        if (postConf) this.st.patch({ pendingTokenConfirm: postConf });
      }
      void this.loadSessions();
    } catch (err) {
      if (reportTempId) {
        this.st.patch({ messages: this.st.snap.messages.filter(m => m.messageId !== reportTempId) });
      }
      void this.loadAgentConfig();
      if (err instanceof ApiError && err.code === 'INVALID_API_KEY') {
        this.handleInvalidKey();
      } else if (err instanceof ApiError && err.code === 'NO_ACTIVE_CONNECTION') {
        this.st.patch({ phase: 'idle' });
        this.openConfigAgents();
      } else if (err instanceof ApiError && (
        err.code === 'TOKEN_LIMIT_TOO_LOW'
        || err.code === 'INPUT_TOKEN_LIMIT_TOO_LOW'
        || err.code === 'MEMORY_TOKEN_LIMIT_TOO_LOW'
      )) {
        this.st.patch({
          phase: 'idle',
          pendingTokenConfirm: this.buildTokenConfirm(err, pendingPrompt, 'report'),
        });
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

  // agent config

  async loadAgentConfig(): Promise<void> {
    try {
      const cfg = await this.api.getAgentConfig();
      this.st.patch({ agentConfig: cfg });
      this.agentDraft       = cfg.agents.map(agent => this.sanitizeAgent(agent));
      this.memoryLimitDraft = this.coercePositiveInt(cfg.memoryLimit, 50);
      // If no personal key was found, check if any active agent exists
      if (!this.st.snap.hasKey) {
        const activeAgent = cfg.agents.find(a => a.status === 'active');
        const hasActive = !!activeAgent;
        if (hasActive) {
          this.st.patch({
            hasKey: true,
            provider: this.normalizeProvider(activeAgent?.provider),
            selectedModel: this.effectiveModel(activeAgent?.model),
          });
        } else if (!cfg.agents.length) {
          // No connection at all — open the add modal directly
          this.showAddAgent    = true;
          this.agentTestStatus = 'idle';
          this.st.patch({ sidebarOpen: true, sidebarTab: 'config' });
        } else {
          // Existing connections are present but none are active — let the user edit/retry them.
          this.showAddAgent = false;
          this.st.patch({ sidebarOpen: true, sidebarTab: 'config' });
        }
      }
    } catch { /* non-critical */ }
  }

  openConfigTab(agentId?: string): void {
    this.showAddAgent = false;
    this.editingAgentIndex = null;
    this.st.patch({ sidebarOpen: true, sidebarTab: 'config' });
    void this.loadAgentConfig().then(() => {
      if (agentId) this.openAgentEditorById(agentId);
    });
  }

  openAddAgentModal(): void {
    this.editingAgentIndex = null;
    this.newAgent = this.createEmptyAgent();
    this.showAddAgent = true;
    this.agentTestStatus = 'idle';
    this.agentTestError = '';
  }

  closeAgentModal(): void {
    this.showAddAgent = false;
    this.editingAgentIndex = null;
    this.newAgent = this.createEmptyAgent();
    this.agentTestStatus = 'idle';
    this.agentTestError = '';
  }

  openEditAgent(index: number): void {
    const agent = this.agentDraft[index];
    if (!agent) return;
    this.editingAgentIndex = index;
    this.newAgent = this.sanitizeAgent({ ...agent });
    this.showAddAgent = true;
    this.agentTestStatus = 'idle';
    this.agentTestError = '';
  }

  openConfigFromTokenWarning(): void {
    const agentId = this.st.snap.pendingTokenConfirm?.agentId;
    this.openConfigTab(agentId);
  }

  private openAgentEditorById(agentId: string): void {
    const index = this.agentDraft.findIndex(agent => agent.id === agentId);
    if (index >= 0) this.openEditAgent(index);
  }

  async addAgentToList(): Promise<void> {
    const agent = this.sanitizeAgent(this.newAgent);
    if (!agent.provider || !agent.model || !agent.apiKey) return;

    const saved = await this.persistAgentConfig([...this.agentDraft, agent], {
      errorMessage: 'Failed to add AI connection.',
    });
    if (!saved) return;

    this.applySavedAgentConfig(saved);
    this.closeAgentModal();
  }

  async saveEditedAgent(): Promise<void> {
    if (this.editingAgentIndex === null) {
      await this.addAgentToList();
      return;
    }

    const agent = this.sanitizeAgent(this.newAgent);
    if (!agent.provider || !agent.model || !agent.apiKey) return;

    const nextAgents = this.agentDraft.map((current, index) =>
      index === this.editingAgentIndex ? { ...current, ...agent } : current,
    );
    const saved = await this.persistAgentConfig(nextAgents, {
      errorMessage: 'Failed to update AI connection.',
    });
    if (!saved) return;

    this.applySavedAgentConfig(saved);
    this.closeAgentModal();
  }

  async removeAgent(index: number): Promise<void> {
    const agent = this.agentDraft[index];
    if (!agent) return;
    if (!window.confirm(`Delete ${this.providerLabel(agent.provider)} · ${this.effectiveModel(agent.model)}?`)) {
      return;
    }

    const nextAgents = this.agentDraft.filter((_, i) => i !== index);
    const saved = await this.persistAgentConfig(nextAgents, {
      errorMessage: 'Failed to delete AI connection.',
    });
    if (!saved) return;

    this.applySavedAgentConfig(saved);
  }

  setAgentStatus(index: number, status: AgentStatus): void {
    this.agentDraft = this.agentDraft.map((a, i) =>
      i === index ? { ...a, status } : a,
    );
  }

  async saveAgentCard(index: number): Promise<void> {
    const saved = await this.persistAgentConfig(this.agentDraft, {
      errorMessage: 'Failed to save AI connection.',
    });
    if (!saved) return;

    this.applySavedAgentConfig(saved);
  }

  async retryAgent(index: number): Promise<void> {
    this.agentDraft = this.agentDraft.map((a, i) =>
      i === index ? { ...a, status: 'active' as AgentStatus } : a,
    );
    await this.saveAgentCard(index);
  }

  async saveAgentConfig(): Promise<void> {
    const saved = await this.persistAgentConfig(this.agentDraft, {
      errorMessage: 'Failed to save config.',
    });
    if (!saved) return;

    this.applySavedAgentConfig(saved);
  }

  private async persistAgentConfig(
    agents: AgentEntry[],
    options: { errorMessage: string },
  ): Promise<AgentConfigResponse | null> {
    this.configSaving = true;
    this.configError  = '';
    try {
      return await this.api.saveAgentConfig({
        memoryLimit: this.coercePositiveInt(this.memoryLimitDraft, 50),
        agents: agents.map(agent => this.sanitizeAgent(agent)),
      });
    } catch (err) {
      const fallback = options.errorMessage;
      this.configError = err instanceof Error && err.message ? err.message : fallback;
      return null;
    } finally {
      this.configSaving = false;
    }
  }

  private applySavedAgentConfig(saved: AgentConfigResponse): void {
    this.st.patch({ agentConfig: saved });
    this.agentDraft       = saved.agents.map(agent => this.sanitizeAgent(agent));
    this.memoryLimitDraft = this.coercePositiveInt(saved.memoryLimit, 50);
    const activeAgent = this.agentDraft.find(a => a.status === 'active');
    this.st.patch({
      hasKey: !!activeAgent,
      provider: this.normalizeProvider(activeAgent?.provider),
      selectedModel: this.effectiveModel(activeAgent?.model),
    });
  }

  readonly STATUS_OPTIONS: AgentStatus[] = ['active', 'idle', 'disabled', 'expired'];

  readonly MEMORY_LIMIT_OPTIONS: { label: string; value: number }[] = [
    { label: '10',           value: 10 },
    { label: '25',           value: 25 },
    { label: '50 (default)', value: 50 },
    { label: '100',          value: 100 },
    { label: '200',          value: 200 },
    { label: '500',          value: 500 },
  ];

  private createEmptyAgent(): AgentEntry {
    return {
      id:               '',
      status:           'active',
      provider:         '',
      model:            '',
      apiKey:           '',
      inputTokenLimit:  8_000,
      outputTokenLimit: 8_000,
      memoryTokenLimit: 4_000,
      inputTokensUsed:  0,
      outputTokensUsed: 0,
    };
  }

  private sanitizeAgent(agent: AgentEntry): AgentEntry {
    return {
      ...agent,
      id:               agent.id?.trim() ?? '',
      provider:         this.effectiveProvider(agent.provider),
      model:            this.effectiveModel(agent.model),
      apiKey:           agent.apiKey.trim(),
      inputTokenLimit:  this.coercePositiveInt(agent.inputTokenLimit, 8_000),
      outputTokenLimit: this.coercePositiveInt(agent.outputTokenLimit, 8_000),
      memoryTokenLimit: this.coercePositiveInt(agent.memoryTokenLimit, 4_000),
      inputTokensUsed:  this.coerceNonNegativeInt(agent.inputTokensUsed),
      outputTokensUsed: this.coerceNonNegativeInt(agent.outputTokensUsed),
    };
  }

  private coercePositiveInt(value: number | string | null | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
  }

  private coerceNonNegativeInt(value: number | string | null | undefined, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
  }

  providerLabel(provider: string | null | undefined): string {
    const normalized = this.normalizeProvider(provider);
    return this.providerOptions.find(option => option.id === normalized)?.label ?? normalized;
  }

  private modelsForProvider(provider: string | null | undefined, currentModel?: string | null): ModelOption[] {
    const normalized = this.normalizeProvider(provider) as ProviderId;
    const baseModels = STATIC_MODELS_BY_PROVIDER[normalized] ?? [];
    const current    = this.effectiveModel(currentModel);
    if (!current || baseModels.some(model => model.id === current)) return baseModels;
    return [...baseModels, { id: current, label: `${current} (Current)` }];
  }

  private activeAgent(): AgentEntry | undefined {
    return this.st.snap.agentConfig?.agents.find(a => a.status === 'active');
  }

  private effectiveOutputTokenLimit(): number {
    return this.activeAgent()?.outputTokenLimit ?? this.st.snap.responseTokenLimit;
  }

  connectionLabel(connection: ConnectionInfo | null | undefined): string {
    if (!connection) return '';
    const provider = this.providerLabel(connection.provider);
    const model    = this.effectiveModel(connection.model);
    const parts = [
      provider ? provider : connection.source === 'agent' ? 'Agent' : 'Personal key',
      model || undefined,
      connection.source === 'agent' ? 'agent' : 'personal',
    ].filter(Boolean);
    return parts.join(' · ');
  }

  private buildAssistantMessage(data: AnalyticsResponse, durationMs: number, prompt: string): ConversationMessage {
    const base = {
      messageId:          data.messageId,
      role:               'assistant' as const,
      prompt,
      inputTokens:        data.inputTokens,
      outputTokens:       data.outputTokens,
      connection:         data.connection,
      tokenLimitExceeded: data.tokenLimitExceeded,
      outputTokenLimit:   data.connection?.outputTokenLimit ?? this.effectiveOutputTokenLimit(),
    };

    if (data.intent === 'dashboard' && 'chart' in data) {
      return { ...base, intent: 'dashboard', result: { type: 'dashboard', dashboardSpec: (data as DashboardResponse).chart, durationMs } };
    }
    if (data.intent === 'report') {
      return { ...base, intent: 'report', result: { type: 'report', reportSections: (data as ReportResponse).reportSections ?? [], durationMs } };
    }
    return { ...base, intent: 'inquiry', result: { type: 'inquiry', summary: (data as InquiryResponse).summary ?? '', durationMs } };
  }

  // ── Token limit confirmation ──────────────────────────────────────────────────

  tokenLimitSaving = false;
  private pendingReportTempId: string | null = null;

  async confirmMaximizeTokens(): Promise<void> {
    const conf = this.st.snap.pendingTokenConfirm;
    if (!conf) return;
    this.st.patch({ pendingTokenConfirm: null });

    if (conf.memoryFix) {
      const ok = conf.agentId
        ? await this.applyAgentTokenLimit(conf.agentId, 'memory', conf.memoryFix.suggested)
        : false;
      if (!ok) {
        this.st.setError('Could not update the memory token limit. Please adjust it manually in Config and retry.');
        return;
      }
    }
    if (conf.outputFix) {
      const ok = conf.agentId
        ? await this.applyAgentTokenLimit(conf.agentId, 'output', conf.outputFix.suggested)
        : await this.applyResponseTokenLimit(conf.outputFix.suggested);
      if (!ok) {
        this.st.setError('Could not update the output token limit. Please adjust it manually in Config and retry.');
        return;
      }
    }
    if (conf.inputFix && conf.agentId) {
      const ok = await this.applyAgentTokenLimit(conf.agentId, 'input', conf.inputFix.suggested);
      if (!ok) {
        this.st.setError('Could not update the input token limit. Please adjust it manually in Config and retry.');
        return;
      }
    }

    if (!conf.retryAfterApply) return;

    if (conf.intent === 'report') {
      // Bypass the format picker — the user already chose their format before the token error.
      this.st.patch({ pendingPrompt: conf.prompt, pendingSuggestion: false });
      await this.chooseReportFormat('report');
    } else {
      this.st.patch({ prompt: conf.prompt, intent: conf.intent });
      await this.run();
    }
  }

  dismissTokenConfirm(): void {
    this.st.patch({ pendingTokenConfirm: null, phase: 'idle' });
  }

  private async applyResponseTokenLimit(limit: number): Promise<boolean> {
    const { userId } = this.st.snap;
    this.tokenLimitSaving = true;
    try {
      await this.api.updateResponseTokenLimit(userId, limit);
      this.st.patch({ responseTokenLimit: limit });
      return true;
    } catch {
      return false;
    } finally {
      this.tokenLimitSaving = false;
    }
  }

  private async applyAgentTokenLimit(agentId: string, kind: 'input' | 'output' | 'memory', limit: number): Promise<boolean> {
    this.tokenLimitSaving = true;
    try {
      await this.api.updateAgentTokenLimit(agentId, kind, limit);
      // Reload from API so the card always shows the true saved value,
      // preventing stale local-draft values from diverging from the DB.
      await this.loadAgentConfig();
      return true;
    } catch {
      return false;
    } finally {
      this.tokenLimitSaving = false;
    }
  }

  async applyResponseTokenLimitFromConfig(): Promise<void> {
    const ok = await this.applyResponseTokenLimit(this.st.snap.responseTokenLimit);
    if (!ok) this.st.setError('Could not update the output token limit. Please try again.');
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
      entity:     '🏷️',
      correction: '✏️',
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
      entity:     'memory-entity',
      correction: 'memory-correction',
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
