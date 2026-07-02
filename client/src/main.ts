import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app/app.component';

// Deliberately NOT using withFetch(): Zone.js's fetch() patching has real
// gaps around error/rejection paths combined with AbortSignal (used
// throughout this app's request timeouts) — a rejected fetch-backed HTTP
// call can update component state correctly while Angular fails to detect
// the change and re-render. XMLHttpRequest (the default here) is Zone.js's
// original, most reliably-patched transport. Nothing in this app depends
// on fetch-specific behavior (no streaming responses).
bootstrapApplication(AppComponent, {
  providers: [provideHttpClient()],
}).catch((error: unknown) => {
  console.error(error);
});
