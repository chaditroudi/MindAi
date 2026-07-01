import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';
import type { ModeKey, PromptExample, ConversationMessage, SessionSummary, SavedResultSummary, SavedResultDetail, MemoryItem, AgentConfigResponse } from './app.types';

export type Phase = 'idle' | 'loading' | 'done' | 'error';

export interface AppState {
  phase:       Phase;
  intent:      ModeKey;
  prompt:      string;
  errorText:   string;
  durationMs:  number;
  examples:    Record<ModeKey, PromptExample[]>;

  sessionId:   string | null;
  messages:    ConversationMessage[];

  sidebarOpen:   boolean;
  sidebarTab:    'history' | 'saved' | 'memory' | 'config';
  sessions:      SessionSummary[];
  savedResults:  SavedResultSummary[];
  viewingSaved:  SavedResultDetail | null;
  memories:                MemoryItem[];
  memoryExtractionEnabled: boolean;
  agentConfig:             AgentConfigResponse | null;

  pendingSuggestion: boolean;
  pendingPrompt:     string;

  pendingTokenConfirm: {
    prompt:          string;
    intent:          ModeKey;
    agentApiKey?:    string;
    memoryFix?:      { current: number; suggested: number; used?: number };
    outputFix?:      { current: number; suggested: number };
    inputFix?:       { current: number; suggested: number };
    retryAfterApply: boolean;
  } | null;

  userId:             string;
  hasKey:             boolean;
  provider:           string;
  selectedModel:      string;
  responseTokenLimit: number;
}

const INITIAL: AppState = {
  phase:       'idle',
  intent:      'dashboard',
  prompt:      '',
  errorText:   '',
  durationMs:  0,
  examples:    { dashboard: [], report: [], inquiry: [] },

  sessionId:   null,
  messages:    [],

  sidebarOpen:   true,
  sidebarTab:    'history',
  sessions:      [],
  savedResults:  [],
  viewingSaved:  null,
  memories:                [],
  memoryExtractionEnabled: true,
  agentConfig:             null,

  pendingSuggestion:   false,
  pendingPrompt:       '',
  pendingTokenConfirm: null,

  userId:             '',
  hasKey:             false,
  provider:           '',
  selectedModel:      '',
  responseTokenLimit: 4_000,
};

@Injectable({ providedIn: 'root' })
export class AnalyticsStateService {
  private readonly _s$ = new BehaviorSubject<AppState>(INITIAL);

  readonly state$  = this._s$.asObservable();
  readonly phase$  = this.state$.pipe(map(s => s.phase), distinctUntilChanged());
  readonly intent$ = this.state$.pipe(map(s => s.intent), distinctUntilChanged());

  get snap(): AppState { return this._s$.value; }

  patch(partial: Partial<AppState>): void {
    this._s$.next({ ...this._s$.value, ...partial });
  }

  setLoading(intent: ModeKey): void {
    this.patch({ phase: 'loading', intent, errorText: '', durationMs: 0 });
  }

  setError(msg: string): void {
    this.patch({ phase: 'error', errorText: msg });
  }

  newSession(): void {
    this.patch({ sessionId: null, messages: [], phase: 'idle', prompt: '', errorText: '', pendingSuggestion: false, pendingPrompt: '', pendingTokenConfirm: null });
  }
}
