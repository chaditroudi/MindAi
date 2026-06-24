import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

export class ApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ApiError';
  }
}
import type {
  AnalyticsRequest, AnalyticsResponse, ProviderResponse,
  MetaResponse, SessionSummary, SessionDetail,
  SavedResultSummary, SavedResultDetail, MessageResult, ModeKey, MemoryItem,
  MemoryConfigResponse,
} from './app.types';

@Injectable({ providedIn: 'root' })
export class AnalyticsApiService {
  private readonly http = inject(HttpClient);

  getProvider(): Promise<ProviderResponse> {
    return this.req(this.http.get<ProviderResponse>('/api/provider'));
  }

  getMeta(): Promise<MetaResponse> {
    return this.req(this.http.get<MetaResponse>('/api/meta'));
  }

  verifyKey(apiKey: string, userId: string): Promise<{ ok: boolean; provider?: string }> {
    const headers = new HttpHeaders({ 'X-User-Id': userId });
    return this.req(this.http.post<{ ok: boolean; provider?: string }>('/api/key', { apiKey }, { headers }));
  }

  runAnalytics(payload: AnalyticsRequest, userId: string, apiKey?: string): Promise<AnalyticsResponse> {
    const hdrs: Record<string, string> = { 'X-User-Id': userId };
    if (apiKey) hdrs['X-User-Api-Key'] = apiKey;
    return this.req(this.http.post<AnalyticsResponse>('/api/analytics', payload, { headers: new HttpHeaders(hdrs) }));
  }

  saveResult(userId: string, payload: { title: string; prompt: string; intent: ModeKey; result: MessageResult }): Promise<{ ok: boolean; id: string }> {
    const headers = new HttpHeaders({ 'X-User-Id': userId });
    return this.req(this.http.post<{ ok: boolean; id: string }>('/api/saved', payload, { headers }));
  }

  listSavedResults(userId: string): Promise<SavedResultSummary[]> {
    const headers = new HttpHeaders({ 'X-User-Id': userId });
    return this.req(this.http.get<SavedResultSummary[]>('/api/saved', { headers }));
  }

  getSavedResult(userId: string, id: string): Promise<SavedResultDetail> {
    const headers = new HttpHeaders({ 'X-User-Id': userId });
    return this.req(this.http.get<SavedResultDetail>(`/api/saved/${id}`, { headers }));
  }

  deleteSavedResult(userId: string, id: string): Promise<{ ok: boolean }> {
    const headers = new HttpHeaders({ 'X-User-Id': userId });
    return this.req(this.http.delete<{ ok: boolean }>(`/api/saved/${id}`, { headers }));
  }

  listMemories(userId: string): Promise<MemoryItem[]> {
    const headers = new HttpHeaders({ 'X-User-Id': userId });
    return this.req(this.http.get<MemoryItem[]>('/api/memory', { headers }));
  }

  clearMemories(userId: string): Promise<{ ok: boolean; deleted: number }> {
    const headers = new HttpHeaders({ 'X-User-Id': userId });
    return this.req(this.http.delete<{ ok: boolean; deleted: number }>('/api/memory', { headers }));
  }

  getMemoryConfig(): Promise<MemoryConfigResponse> {
    return this.req(this.http.get<MemoryConfigResponse>('/api/memory/config'));
  }

  setMemoryConfig(enabled: boolean): Promise<{ ok: boolean; extractionEnabled: boolean }> {
    return this.req(this.http.patch<{ ok: boolean; extractionEnabled: boolean }>('/api/memory/config', { extractionEnabled: enabled }));
  }

  listSessions(): Promise<SessionSummary[]> {
    return this.req(this.http.get<SessionSummary[]>('/api/history/sessions'));
  }

  getSession(sessionId: string): Promise<SessionDetail> {
    return this.req(this.http.get<SessionDetail>(`/api/history/sessions/${sessionId}`));
  }

  deleteSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.req(this.http.delete<{ ok: boolean }>(`/api/history/sessions/${sessionId}`));
  }

  private req<T>(stream: Observable<T>): Promise<T> {
    return firstValueFrom(
      stream.pipe(
        timeout(480_000),
        catchError((error: unknown) => {
          if (error instanceof TimeoutError)
            return throwError(() => new Error('Request timed out. Check that the server is running.'));
          if (error instanceof HttpErrorResponse) {
            if (error.status === 0)
              return throwError(() => new Error('Cannot reach the server. Please refresh the page and try again.'));
            const message = typeof error.error?.error === 'string' ? error.error.error : error.message;
            const code    = typeof error.error?.code  === 'string' ? error.error.code  : undefined;
            return throwError(() => code ? new ApiError(message, code) : new Error(message));
          }
          if (error instanceof Error) return throwError(() => error);
          return throwError(() => new Error('An unexpected error occurred.'));
        }),
      ),
    );
  }
}
