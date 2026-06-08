import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import type { AnalyticsRequest, AnalyticsResponse, MetaResponse } from './app.types';

@Injectable({ providedIn: 'root' })
export class AnalyticsApiService {
  private readonly http = inject(HttpClient);

  getMeta(): Promise<MetaResponse> {
    return this.request(this.http.get<MetaResponse>('/api/meta'));
  }

  runAnalytics(payload: AnalyticsRequest): Promise<AnalyticsResponse> {
    return this.request(this.http.post<AnalyticsResponse>('/api/analytics', payload));
  }

  private request<T>(stream: Observable<T>): Promise<T> {
    return firstValueFrom(
      stream.pipe(
        timeout(480_000),
        catchError((error: unknown) => {
          if (error instanceof TimeoutError) {
            return throwError(() => new Error('انتهت المهلة. تحقق من الخادم.'));
          }

          if (error instanceof HttpErrorResponse) {
            const message = typeof error.error?.error === 'string'
              ? error.error.error
              : error.message;
            return throwError(() => new Error(message));
          }

          if (error instanceof Error) {
            return throwError(() => error);
          }

          return throwError(() => new Error('حدث خطأ غير متوقع.'));
        }),
      ),
    );
  }
}
