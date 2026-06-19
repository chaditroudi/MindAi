from fpdf import FPDF
import os

OUTPUT = os.path.join(os.path.dirname(__file__), "MindAi_NestApp_Codebase.pdf")

# ── colour palette ────────────────────────────────────────────────────────────
C_DARK   = (15,  23,  42)   # slate-900
C_BLUE   = (37,  99, 235)   # blue-600
C_LIGHT  = (241, 245, 249)  # slate-100
C_WHITE  = (255, 255, 255)
C_ACCENT = (16, 185, 129)   # emerald-500
C_WARN   = (245, 158,  11)  # amber-500
C_CODE   = (30,  41,  59)   # slate-800
C_GRAY   = (100, 116, 139)  # slate-500

class PDF(FPDF):

    # ── helpers ───────────────────────────────────────────────────────────────

    def _rgb(self, triple):
        return triple[0], triple[1], triple[2]

    def set_fill(self, triple):
        self.set_fill_color(*self._rgb(triple))

    def set_draw_c(self, triple):
        self.set_draw_color(*self._rgb(triple))

    def set_text_c(self, triple):
        self.set_text_color(*self._rgb(triple))

    # ── header / footer ───────────────────────────────────────────────────────

    def header(self):
        if self.page_no() == 1:
            return
        self.set_fill(C_DARK)
        self.rect(0, 0, 210, 12, 'F')
        self.set_font('Helvetica', 'B', 8)
        self.set_text_c(C_WHITE)
        self.set_xy(10, 2)
        self.cell(0, 8, 'MindAi  —  NestJS App Codebase Reference', ln=False)
        self.set_xy(-30, 2)
        self.cell(20, 8, f'Page {self.page_no()}', align='R')
        self.set_text_c(C_DARK)
        self.ln(10)

    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-12)
        self.set_fill(C_LIGHT)
        self.rect(0, self.get_y(), 210, 12, 'F')
        self.set_font('Helvetica', '', 7)
        self.set_text_c(C_GRAY)
        self.cell(0, 10, 'MindAi NestJS Application  |  Confidential  |  Auto-generated', align='C')

    # ── building blocks ───────────────────────────────────────────────────────

    def cover(self):
        self.add_page()
        # background
        self.set_fill(C_DARK)
        self.rect(0, 0, 210, 297, 'F')

        # accent bar
        self.set_fill(C_BLUE)
        self.rect(0, 80, 210, 6, 'F')

        # title
        self.set_font('Helvetica', 'B', 36)
        self.set_text_c(C_WHITE)
        self.set_xy(0, 95)
        self.cell(210, 18, 'MindAi', align='C')

        self.set_font('Helvetica', '', 20)
        self.set_text_c((148, 163, 184))
        self.set_xy(0, 116)
        self.cell(210, 12, 'NestJS Application — Full Codebase Reference', align='C')

        # accent line
        self.set_fill(C_ACCENT)
        self.rect(60, 136, 90, 2, 'F')

        # subtitle block
        self.set_font('Helvetica', '', 11)
        self.set_text_c((203, 213, 225))
        lines = [
            'AI-powered analytics platform with conversational memory',
            'Built on NestJS  •  MongoDB / Mongoose  •  Groq LLM  •  Angular 21',
            '',
            'Covers every file: architecture, request flow,',
            'AI pipeline, caching, memory, and all modules.',
        ]
        y = 148
        for line in lines:
            self.set_xy(0, y)
            self.cell(210, 8, line, align='C')
            y += 8

        # badge row
        badges = [
            (C_BLUE,   'NestJS'),
            (C_ACCENT, 'MongoDB'),
            (C_WARN,   'Groq LLM'),
            ((139, 92, 246), 'Angular 21'),
        ]
        bx = 20
        by = 210
        for color, label in badges:
            self.set_fill(color)
            self.set_text_c(C_WHITE)
            self.set_font('Helvetica', 'B', 9)
            self.set_xy(bx, by)
            self.cell(38, 10, label, align='C', fill=True)
            bx += 44

        self.set_text_c(C_DARK)

    def chapter_title(self, num, title, subtitle=''):
        self.add_page()
        self.set_fill(C_BLUE)
        self.rect(0, 12, 210, 30, 'F')
        self.set_font('Helvetica', '', 10)
        self.set_text_c(C_WHITE)
        self.set_xy(10, 17)
        self.cell(0, 6, f'CHAPTER  {num}')
        self.set_font('Helvetica', 'B', 20)
        self.set_xy(10, 24)
        self.cell(0, 10, title)
        if subtitle:
            self.set_font('Helvetica', '', 10)
            self.set_xy(10, 36)
            self.set_text_c((186, 230, 253))
            self.cell(0, 6, subtitle)
        self.set_text_c(C_DARK)
        self.ln(20)

    def section(self, title):
        self.ln(4)
        self.set_fill(C_LIGHT)
        self.rect(10, self.get_y(), 190, 9, 'F')
        self.set_font('Helvetica', 'B', 12)
        self.set_text_c(C_BLUE)
        self.set_x(13)
        self.cell(0, 9, title)
        self.set_text_c(C_DARK)
        self.ln(12)

    def subsection(self, title):
        self.ln(3)
        self.set_font('Helvetica', 'B', 10)
        self.set_text_c(C_DARK)
        self.set_x(10)
        self.set_draw_c(C_BLUE)
        self.set_fill(C_BLUE)
        self.rect(10, self.get_y() + 2, 3, 6, 'F')
        self.set_x(16)
        self.cell(0, 10, title)
        self.set_text_c(C_DARK)
        self.ln(8)

    def body(self, text, indent=10):
        self.set_font('Helvetica', '', 10)
        self.set_text_c(C_DARK)
        self.set_x(indent)
        self.multi_cell(210 - indent - 10, 6, text)
        self.ln(2)

    def code(self, text, label=''):
        if label:
            self.set_font('Helvetica', 'I', 8)
            self.set_text_c(C_GRAY)
            self.set_x(10)
            self.cell(0, 6, label)
            self.ln(6)
        self.set_fill(C_CODE)
        lines = text.strip().split('\n')
        h = len(lines) * 5 + 6
        self.set_fill(C_CODE)
        self.rect(10, self.get_y(), 190, h, 'F')
        self.set_font('Courier', '', 8)
        self.set_text_c((226, 232, 240))
        for line in lines:
            self.set_x(14)
            self.cell(182, 5, line[:95])
            self.ln(5)
        self.set_text_c(C_DARK)
        self.ln(4)

    def file_header(self, path, description):
        self.ln(2)
        self.set_fill((219, 234, 254))
        self.rect(10, self.get_y(), 190, 14, 'F')
        self.set_font('Courier', 'B', 9)
        self.set_text_c(C_BLUE)
        self.set_x(13)
        self.cell(0, 7, path)
        self.ln(7)
        self.set_font('Helvetica', 'I', 9)
        self.set_text_c(C_DARK)
        self.set_x(13)
        self.cell(0, 7, description)
        self.ln(10)

    def info_box(self, title, text, color=C_BLUE):
        self.set_fill((*color, 30))
        self.set_fill_color(color[0], color[1], color[2])
        y0 = self.get_y()
        self.rect(10, y0, 190, 4, 'F')
        self.set_font('Helvetica', 'B', 9)
        self.set_text_c(C_WHITE)
        self.set_x(13)
        self.cell(0, 4, title)
        self.ln(4)
        self.set_fill(C_LIGHT)
        self.rect(10, self.get_y(), 190, 20, 'F')
        self.set_font('Helvetica', '', 9)
        self.set_text_c(C_DARK)
        self.set_x(13)
        self.multi_cell(184, 5, text)
        self.ln(4)

    def two_col_table(self, headers, rows, widths=(80, 110)):
        # header row
        self.set_fill(C_DARK)
        self.set_text_c(C_WHITE)
        self.set_font('Helvetica', 'B', 9)
        self.set_x(10)
        for i, h in enumerate(headers):
            self.cell(widths[i], 7, h, border=0, fill=True)
        self.ln(7)
        # data rows
        for idx, row in enumerate(rows):
            fill = C_LIGHT if idx % 2 == 0 else C_WHITE
            self.set_fill(*[fill]) if False else None
            self.set_fill_color(*fill)
            self.set_text_c(C_DARK)
            self.set_font('Helvetica', '', 9)
            self.set_x(10)
            y_before = self.get_y()
            # col 0
            self.set_x(10)
            self.set_font('Courier', '', 8)
            self.set_text_c(C_BLUE)
            self.cell(widths[0], 6, row[0][:50], fill=True, border=0)
            # col 1
            self.set_font('Helvetica', '', 9)
            self.set_text_c(C_DARK)
            self.cell(widths[1], 6, row[1][:65], fill=True, border=0)
            self.ln(6)
        self.ln(4)

    def three_col_table(self, headers, rows, widths=(55, 55, 80)):
        self.set_fill(C_DARK)
        self.set_text_c(C_WHITE)
        self.set_font('Helvetica', 'B', 9)
        self.set_x(10)
        for i, h in enumerate(headers):
            self.cell(widths[i], 7, h, border=0, fill=True)
        self.ln(7)
        for idx, row in enumerate(rows):
            fill = C_LIGHT if idx % 2 == 0 else C_WHITE
            self.set_fill_color(*fill)
            self.set_x(10)
            self.set_font('Courier', '', 8)
            self.set_text_c(C_BLUE)
            self.cell(widths[0], 6, row[0][:28], fill=True)
            self.set_font('Helvetica', '', 9)
            self.set_text_c(C_DARK)
            self.cell(widths[1], 6, row[1][:28], fill=True)
            self.cell(widths[2], 6, row[2][:50], fill=True)
            self.ln(6)
        self.ln(4)

    def flow_step(self, step, label, detail=''):
        self.set_fill(C_BLUE)
        self.set_text_c(C_WHITE)
        self.set_font('Helvetica', 'B', 9)
        x = 10
        self.set_x(x)
        self.cell(10, 8, str(step), align='C', fill=True)
        self.set_fill(C_LIGHT)
        self.set_text_c(C_DARK)
        self.set_font('Helvetica', 'B', 9)
        self.cell(80, 8, '  ' + label, fill=True)
        if detail:
            self.set_font('Helvetica', '', 8)
            self.set_text_c(C_GRAY)
            self.cell(100, 8, detail, fill=True)
        self.ln(9)

    def arrow(self):
        self.set_font('Helvetica', '', 10)
        self.set_text_c(C_BLUE)
        self.set_x(13)
        self.cell(0, 5, '    v')
        self.ln(5)

# ══════════════════════════════════════════════════════════════════════════════
# CONTENT
# ══════════════════════════════════════════════════════════════════════════════

pdf = PDF()
pdf.set_auto_page_break(auto=True, margin=18)
pdf.set_margins(0, 0, 0)

# ── COVER ─────────────────────────────────────────────────────────────────────
pdf.cover()

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 1 — OVERVIEW
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('1', 'Project Overview', 'What MindAi is and why a NestJS app exists')

pdf.section('What is MindAi?')
pdf.body(
    'MindAi is an AI-powered analytics platform. Users type a natural-language question — '
    '"Show me project spending by municipality" — and the system automatically:\n'
    '  1. Calls a Groq LLM (Supervisor) to translate the question into a MongoDB aggregation pipeline\n'
    '  2. Runs that pipeline against the configured data collections\n'
    '  3. Calls a second LLM (Chart or Writer) to format the results as a dashboard, report, or summary\n'
    '  4. Returns structured output rendered by the Angular frontend using ECharts'
)

pdf.section('Why Two Backends?')
pdf.body(
    'The repository contains two separate backend implementations that do the same job:\n\n'
    '  src/           Express backend (original) — runs on port 3000\n'
    '  nest-app/      NestJS backend (structured rewrite) — runs on port 3001\n\n'
    'The NestJS version is the more production-ready implementation. It adds:\n'
    '  • NestJS dependency injection (DI) — services, modules, guards, filters wired automatically\n'
    '  • Mongoose ODM — schema-first MongoDB access with @Schema / @Prop decorators\n'
    '  • Long-term memory extraction — after every response, key facts are extracted and stored\n'
    '  • Embedding-based semantic retrieval — memories recalled by meaning, not keywords\n'
    '  • API key fallback — if a user\'s key fails, transparently retries with the global key'
)

pdf.section('Technology Stack')
pdf.three_col_table(
    ['Layer', 'Technology', 'Purpose'],
    [
        ('Runtime',       'Node.js 22 / TypeScript',       'Server language'),
        ('Framework',     'NestJS 10',                     'DI, modules, decorators, lifecycle'),
        ('HTTP',          'Express (under NestJS)',        'HTTP transport'),
        ('Database',      'MongoDB + Mongoose',            'Persistent storage + ODM'),
        ('Session Memory','LibSQL / SQLite (Mastra)',      'Short-term conversation threads'),
        ('Long-term Mem', 'MongoDB memory_items',          'Cross-session semantic memory'),
        ('LLM Provider',  'Groq (OpenAI-compatible API)',  'Fast llama-3.3-70b inference'),
        ('AI SDK',        'Vercel AI SDK (generateObject)','Structured LLM output + Zod'),
        ('Agent',         'Mastra Agent + Tools',          'Free-text intent routing'),
        ('Embeddings',    '@xenova/transformers (WASM)',   'Local embedding model, no API key'),
        ('Frontend',      'Angular 21 + ECharts',         'Chart rendering, UI'),
        ('Validation',    'class-validator + Zod',        'DTO & schema validation'),
        ('Security',      'Helmet + CORS + ApiKeyGuard',  'HTTP security headers & auth'),
    ],
    widths=(45, 65, 80)
)

pdf.section('High-Level Architecture')
pdf.code(
    'nest-app/src/\n'
    '  main.ts                 App entry point (port 3001)\n'
    '  app.module.ts           Root DI module\n'
    '  config/                 All env variables typed & grouped\n'
    '  constants/              LLM model/timeout lookup tables\n'
    '  common/                 Logger, guard, filter, middleware (shared)\n'
    '  database/               MongoDB connection (DatabaseModule)\n'
    '  ai/                     All LLM calls + embedding model\n'
    '  analytics/              Main HTTP handler (controller+service+pipeline)\n'
    '  features/               Standalone feature functions (agent fallback path)\n'
    '  session/                Short-term memory (LibSQL) + Mastra agent\n'
    '  memory/                 Long-term semantic memory (MongoDB + embeddings)\n'
    '  history/                Pipeline run logs + session history\n'
    '  cache/                  Prompt cache (7-day TTL, SHA-256 keyed)\n'
    '  sources/                Data source registry + in-memory cache\n'
    '  saved-results/          User-saved report snapshots\n'
    '  user-keys/              Per-user Groq API key storage\n'
    '  prompts/                System prompt builders for each LLM role\n'
    '  types/                  Shared TypeScript interfaces',
    'Directory structure'
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 2 — ENTRY POINT & CONFIG
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('2', 'Entry Point & Configuration', 'main.ts, app.module.ts, configuration.ts, Model.ts')

pdf.file_header('nest-app/src/main.ts', 'Application bootstrap — first file executed when the server starts')
pdf.body(
    'main.ts is the Node.js entry point. It performs these steps in order:\n\n'
    '  1. NestFactory.create(AppModule) — instantiates the entire DI container and all modules\n'
    '  2. app.useLogger(AppLogger) — replaces NestJS default logger with the custom colored logger\n'
    '  3. app.use(helmet()) — adds security HTTP headers (CSP disabled for Angular compatibility)\n'
    '  4. app.enableCors() — allows browser requests from configured ALLOWED_ORIGINS\n'
    '  5. app.useGlobalPipes(ValidationPipe) — auto-validates all DTO classes on every request\n'
    '  6. app.enableShutdownHooks() — listens for SIGTERM/SIGINT for graceful shutdown\n'
    '  7. app.listen(3001) — starts the HTTP server\n'
    '  8. warmupEmbeddings() — pre-loads the 25MB local AI model in background\n\n'
    'The port is 3001 (not 3000) to avoid conflict with the Express backend running on 3000.'
)
pdf.code(
    'async function bootstrap() {\n'
    '  const app = await NestFactory.create(AppModule, { bufferLogs: true });\n'
    '  app.useLogger(app.get(AppLogger));\n'
    '  app.use(helmet({ contentSecurityPolicy: false }));\n'
    '  app.enableCors(allowedOrigins.length ? { origin: allowedOrigins } : { origin: true });\n'
    '  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));\n'
    '  app.enableShutdownHooks();\n'
    '  await app.listen(3001);\n'
    '  warmupEmbeddings();  // background — no await\n'
    '}',
    'main.ts — simplified bootstrap'
)

pdf.file_header('nest-app/src/app.module.ts', 'Root module — wires every feature module + global providers')
pdf.body(
    'AppModule is the root of the NestJS dependency injection tree. Every feature module is imported here. '
    'Two providers are registered globally:\n\n'
    '  APP_GUARD  → ApiKeyGuard   — runs before EVERY route handler automatically\n'
    '  APP_FILTER → AllExceptionsFilter — catches EVERY uncaught exception app-wide\n\n'
    'It also conditionally serves the Angular static files if client/dist/ exists. '
    'The RequestIdMiddleware is applied to all routes via configure().'
)
pdf.two_col_table(
    ['Module', 'What it provides'],
    [
        ('ConfigModule (global)',    'ConfigService — typed env variable access everywhere'),
        ('DatabaseModule',          'MongoDB connection via Mongoose forRootAsync'),
        ('SourcesModule',           'Data source registry, in-memory cache, /api/sources routes'),
        ('HistoryModule',           'Pipeline run history, session history routes'),
        ('CacheModule',             'Prompt cache (7-day TTL) + /api/cache routes'),
        ('SavedResultsModule',      'User-saved analytics snapshots'),
        ('UserKeysModule',          'Per-user Groq API key storage'),
        ('AnalyticsModule',         'Main analytics controller + pipeline service'),
        ('ServeStaticModule',       'Serves Angular build if present (optional)'),
    ]
)

pdf.file_header('nest-app/src/config/configuration.ts', 'All environment variables typed and grouped into a config object')
pdf.body(
    'Returns a typed config factory read by NestJS ConfigModule. Groups variables into three namespaces:\n\n'
    '  server.*   — PORT, SHUTDOWN_TIMEOUT_MS, ALLOWED_ORIGINS, API_KEY\n'
    '  mongodb.*  — URI, DB name, timeouts, retry count, pipeline timeout\n'
    '  llm.*      — GROQ_API_KEY, per-role timeouts, default model name\n\n'
    'The helper positiveInt(env, fallback) safely converts string env vars to numbers, '
    'falling back to the default if the value is missing or invalid.'
)

pdf.file_header('nest-app/src/constants/Model.ts', 'LLM role lookup tables — model names, env keys, timeouts')
pdf.body(
    'Defines three Record<AgentRole, string> objects used by ai/model.ts:\n\n'
    '  ROLE_ENV_KEYS   — which env variable overrides the model for each role\n'
    '  ROLE_DEFAULTS   — default model if no override is set\n'
    '  TIMEOUT_ENV_KEYS — which env variable sets the timeout for each role\n\n'
    'The "memory" role deliberately uses a smaller, cheaper model (llama-3.1-8b-instant) '
    'because memory extraction runs on every response and does not need the full 70B model.'
)
pdf.three_col_table(
    ['Role', 'Default Model', 'Env Override'],
    [
        ('supervisor', 'llama-3.3-70b-versatile', 'GROQ_SUPERVISOR_MODEL'),
        ('chart',      'llama-3.3-70b-versatile', 'GROQ_CHART_MODEL'),
        ('writer',     'llama-3.3-70b-versatile', 'GROQ_WRITER_MODEL'),
        ('memory',     'llama-3.1-8b-instant',    'GROQ_MEMORY_MODEL'),
    ],
    widths=(35, 80, 75)
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 3 — COMMON UTILITIES
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('3', 'Common Utilities', 'Logger, Guard, Filter, Middleware — shared across all modules')

pdf.file_header('common/logger/app.logger.ts', 'Custom colored console logger with per-request ID tracking')
pdf.body(
    'Provides two things:\n\n'
    '  1. Standalone functions (log, logTrace, logSep) — used by plain code (repositories, '
    'services) that is not injectable. These call emit() internally.\n\n'
    '  2. AppLogger class (implements LoggerService) — used by NestJS itself for framework '
    'messages (module startup, route registration, errors).\n\n'
    'Both share a singleton AsyncLocalStorage store (requestContext). The '
    'RequestIdMiddleware puts a UUID into this store at the start of each HTTP request. '
    'Every log line then automatically includes a short prefix like [a3f7b2c1] so you can '
    'grep all log lines belonging to one request.\n\n'
    'Log levels: log (info), warn, error, debug (only if DEBUG=1 env), verbose (suppressed). '
    'TRACE=1 env enables logTrace() calls which dump full JSON objects like LLM plans and results.'
)
pdf.code(
    'export const requestContext = new AsyncLocalStorage<{ requestId: string }>();\n\n'
    'function emit(tag: string, msg: string): void {\n'
    '  const store = requestContext.getStore();\n'
    '  const reqId = store ? `[${store.requestId.slice(0, 8)}]` : "";\n'
    '  const color = TAG_COLORS[tag] ?? COLORS.gray;\n'
    '  console.log(`[${ts()}]${reqId} [${tag}] ${msg}`);\n'
    '}\n\n'
    'export function log(tag: string, msg: string): void { emit(tag, msg); }',
    'app.logger.ts — simplified core'
)

pdf.file_header('common/middleware/request-id.middleware.ts', 'Assigns a UUID to each request via AsyncLocalStorage')
pdf.body(
    'An Express/NestJS middleware that runs before every route handler. '
    'Calls requestContext.run({ requestId: randomUUID() }, next) which wraps the entire '
    'async call chain in a context zone. Any code downstream — even in async callbacks — '
    'can call requestContext.getStore() to get the same request ID without it being passed '
    'as a parameter. This is how the logger correlates log lines to requests.'
)

pdf.file_header('common/guards/api-key.guard.ts', 'Server-level authentication — validates x-api-key header')
pdf.body(
    'Implements CanActivate. Applied globally via APP_GUARD in app.module.ts, '
    'so it runs on every single route.\n\n'
    'Logic:\n'
    '  1. If API_KEY env var is not set → pass all requests through (dev mode)\n'
    '  2. If the requested path is in the public list → pass through\n'
    '  3. Otherwise → check x-api-key header matches API_KEY → throw 401 if wrong\n\n'
    'Public routes (no auth required):\n'
    '  /api/meta, /health, /api/provider — read-only metadata\n'
    '  /api/key/* — user API key management (uses x-user-id instead)'
)

pdf.file_header('common/filters/all-exceptions.filter.ts', 'Global error handler — converts any exception to consistent JSON')
pdf.body(
    'Catches every exception thrown anywhere in the app (decorated with @Catch() which '
    'matches all exception types). Applied globally via APP_FILTER in app.module.ts.\n\n'
    'Behavior:\n'
    '  • HttpException (400, 401, 404 etc) → uses its status + message\n'
    '  • Any other Error → 500 + logs full stack trace\n'
    '  • Extracts optional "code" field (e.g. INVALID_API_KEY, LLM_RATE_LIMIT) and '
    'includes it in the response so the frontend can display specific error messages\n\n'
    'Response shape: { error: "message", code?: "SOME_CODE" }'
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 4 — DATABASE
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('4', 'Database Layer', 'MongoDB connection, Mongoose schemas, raw MongoClient')

pdf.section('Two Database Clients')
pdf.body(
    'The nest-app uses MongoDB in two ways simultaneously:\n\n'
    '  1. Mongoose (via MongooseModule) — the primary ORM. '
    'Used by all injectable services. Registered in DatabaseModule and available '
    'via @InjectModel() and @InjectConnection() decorators.\n\n'
    '  2. Raw MongoClient (mongo.client.ts) — a standalone singleton. '
    'Used only by the Mastra agent fallback path (features/pipeline.ts) which is not '
    'inside the NestJS DI container and cannot use @InjectConnection().\n\n'
    'Both point to the same MongoDB database specified by MONGODB_URI + MONGODB_DB env vars.'
)

pdf.file_header('database/database.module.ts', 'Sets up Mongoose global connection using NestJS async factory')
pdf.body(
    'Uses MongooseModule.forRootAsync() with a ConfigService factory. This pattern defers '
    'the connection until the ConfigModule is ready, ensuring env variables are loaded first. '
    'Sets serverSelectionTimeoutMS from config (default 8 seconds). '
    'Any module that imports DatabaseModule (or imports it transitively) gets access to '
    'the Mongoose connection for injecting models.'
)

pdf.file_header('database/mongo.client.ts', 'Raw MongoClient singleton with retry logic — used by agent fallback path')
pdf.body(
    'A module-level singleton (client, db variables). getMongo() is idempotent — '
    'returns the existing connection if already established. On first call, it '
    'attempts to connect up to MONGODB_CONNECT_RETRIES times (default 1). '
    'If all attempts fail, throws a descriptive error including the database name and timeout. '
    'closeMongo() is available for graceful shutdown.'
)

pdf.section('MongoDB Collections Used')
pdf.two_col_table(
    ['Collection', 'Purpose'],
    [
        ('sources',          'Registered DataSource metadata (schema, fields, joins)'),
        ('prompt_cache',     '7-day TTL cache keyed by SHA-256 of intent+prompt'),
        ('results_history',  'Every pipeline execution log (prompt, pipeline, rows, timing)'),
        ('chart_results',    'Cached dashboard specs from runChart()'),
        ('saved_results',    'User-saved report/dashboard snapshots'),
        ('user_api_keys',    'Per-user Groq API key (userId → apiKey mapping)'),
        ('memory_items',     'Long-term semantic memories (type, content, embedding, tags)'),
        ('Data collections', 'e.g. projects, municipalities — seeded by scripts/seed.ts'),
    ]
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 5 — AI LAYER
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('5', 'AI Layer', 'LLM calls, chart rendering, embeddings, memory extraction')

pdf.section('Overview — LLM Roles')
pdf.body(
    'The AI layer makes up to 3 LLM calls per user request. Each call uses a separate '
    '"role" with its own model, timeout, and system prompt:\n'
)
pdf.three_col_table(
    ['Role', 'File', 'Purpose'],
    [
        ('supervisor', 'ai/planner.ts',      'Translates prompt → MongoDB pipeline + strategy'),
        ('chart',      'ai/chart.ts',        'Selects chart types + field mappings'),
        ('writer',     'ai/writer.ts',       'Writes report sections or inquiry summary'),
        ('memory',     'ai/memory-skill.ts', 'Extracts key facts from completed turns'),
    ],
    widths=(30, 60, 100)
)

pdf.file_header('ai/model.ts', 'Groq client factory — resolveModel(), freshSignal(), modelName()')
pdf.body(
    'Three functions used by every LLM call in the system:\n\n'
    'resolveModel(role, apiKey) — creates a Groq OpenAI-compatible client. '
    'The baseURL is https://api.groq.com/openai/v1. Picks the model name from '
    'ROLE_DEFAULTS or the appropriate env variable override. The apiKey parameter '
    'lets per-user keys override the global key on a per-request basis.\n\n'
    'freshSignal(role) — creates a new AbortSignal.timeout(ms) for the role\'s '
    'configured timeout. A fresh signal is created for each call so timeouts '
    'don\'t accumulate across retries.\n\n'
    'modelName(role) — returns just the model name string (used for logging).'
)

pdf.file_header('ai/planner.ts', 'Supervisor LLM — converts natural language to MongoDB aggregation pipeline')
pdf.body(
    'This is LLM Call #1. It is the most critical function in the system.\n\n'
    'Input: user prompt + intent + list of all registered DataSource schemas + conversation context\n'
    'Output: a TaskPlan with { needsData, pipeline, skills, strategy, chartHint }\n\n'
    'The Zod schema passed to generateObject() changes based on intent:\n'
    '  • dashboard — adds strategy enum + chartHint string\n'
    '  • report    — adds wantChart boolean + optional strategy\n'
    '  • inquiry   — base schema only\n\n'
    'After the LLM responds, finalizeTaskPlan() resolves the source name to the actual '
    'registered DataSource (using normalizeToken for fuzzy matching) and calls '
    'deriveExecutionSkills() to determine which downstream skills to run:\n'
    '  dashboard → [aggregation, chart]\n'
    '  report    → [aggregation, report] or [aggregation, report, chart] if wantChart\n'
    '  inquiry   → [aggregation, inquiry]\n\n'
    'Settings: temperature=0 (deterministic), maxRetries=1, maxTokens=600.'
)

pdf.file_header('ai/chart.ts', 'Chart renderer — LLM selects widget types, deterministic code renders them')
pdf.body(
    'The largest file (~530 lines). Two-phase approach:\n\n'
    'Phase 1 — LLM: generateObject() with dashboardSchema (layout + widgets[]). '
    'The LLM picks chart types, field names for axes/values/labels, aggregation method, '
    'optional topN/sortDesc, and an insight string. This is constrained by Zod enums '
    'loaded from skills/chart/SKILL.md at startup.\n\n'
    'Phase 2 — Deterministic: For each proposed widget:\n'
    '  a) validateWidget() — checks field names exist in actual data, numeric fields are '
    'numeric, required fields like seriesField are present\n'
    '  b) toWidgetPlan() — normalizes the widget (e.g. auto-detects valueField if missing)\n'
    '  c) renderWidget() → calls the specific renderer function\n\n'
    'Renderer functions produce ECharts option objects. All 15 chart types are supported:'
)
pdf.three_col_table(
    ['Chart Type', 'Key Fields', 'Notes'],
    [
        ('bar_chart',           'labelField, valueField',          'Vertical bars'),
        ('horizontal_bar_chart','labelField, valueField',          'Flipped axes'),
        ('grouped_bar_chart',   'labelField, valueField,seriesField','Side-by-side groups'),
        ('stacked_bar_chart',   'labelField, valueField,seriesField','Stacked totals'),
        ('line_chart',          'xField, valueField',              'Auto-sorts by axis'),
        ('area_chart',          'xField, valueField',              'Line with fill'),
        ('multi_line_chart',    'xField, valueField,seriesField',  'Multiple series'),
        ('donut_chart',         'labelField, valueField',          'Pie with hole'),
        ('scatter_plot',        'xField, yField',                  'Optional labelField'),
        ('kpi_card',            'valueField',                      'Single number display'),
        ('gauge_chart',         'valueField',                      'Circular gauge 0-100'),
        ('funnel_chart',        'labelField, valueField',          'Funnel visualization'),
        ('radar_chart',         'labelField, columns[]',           'Multi-metric spider'),
        ('heatmap',             'xField, yField, valueField',      'Grid intensity map'),
        ('table',               'columns[]',                       'Raw data table'),
    ],
    widths=(55, 65, 70)
)

pdf.file_header('ai/writer.ts', 'Writer LLM — generates inquiry summaries and report sections')
pdf.body(
    'Two exported functions:\n\n'
    'runInquirySkill({ prompt, rows }) — LLM Call #2 for inquiry intent. '
    'System prompt read from skills/inquiry/SKILL.md at startup. '
    'Returns { summary: string } (max 400 tokens). Sends only the first INQUIRY_MAX_ROWS '
    'rows to keep token usage low.\n\n'
    'runReportSkill({ prompt, rows, withChart }) — LLM Call #2 for report intent. '
    'System prompt from skills/report/SKILL.md. Returns { reportSections: [{heading, body}] } '
    'with 1-5 sections (max 900 tokens). The withChart flag tells the LLM whether a '
    'visual chart will accompany the report so it can adjust the prose accordingly.\n\n'
    'Both use: temperature=0, maxRetries=1, generateObject() with Zod schema.'
)

pdf.file_header('ai/memory-skill.ts', 'Memory extraction LLM — pulls key facts from completed conversations')
pdf.body(
    'Called fire-and-forget after every analytics response (in AnalyticsService.maybeExtractMemory). '
    'Uses the cheaper "memory" role model (llama-3.1-8b-instant).\n\n'
    'Input: user prompt + AI response summary\n'
    'Output: up to 3 memory items, each with:\n'
    '  • type: goal | insight | preference | context | decision\n'
    '  • content: 5-300 character string\n'
    '  • tags: up to 5 keyword strings\n'
    '  • importance: integer 1-5\n\n'
    'maxRetries=0 and errors are caught/ignored — memory extraction never blocks responses. '
    'System prompt is read from skills/memory/SKILL.md.'
)

pdf.file_header('ai/skill-prompt.ts', 'Reads system prompts from Markdown files in the skills/ folder')
pdf.body(
    'Three utility functions:\n\n'
    'skillFile(...segments) — resolves the absolute path to a file in skills/\n\n'
    'readMarkdownSection(filePath, heading) — extracts the text content under a specific '
    '## Heading in a Markdown file, stopping at the next heading of equal or higher level. '
    'Used to load system prompts at module startup (once, not per request).\n\n'
    'readJsonSection(filePath, heading) — calls readMarkdownSection then parses the '
    'first ```json code block inside that section. Used by chart.ts to load the chart '
    'type definitions and aggregation lists from skills/chart/SKILL.md.\n\n'
    'interpolateTemplate(template, values) — replaces {{VARIABLE}} placeholders. '
    'Used for dynamic prompt assembly with values like source name or field list.'
)

pdf.file_header('ai/embeddings.ts', 'Local sentence embedding model — converts text to 384-dimensional vectors')
pdf.body(
    'Uses @xenova/transformers to run the all-MiniLM-L6-v2 model locally via WebAssembly. '
    'No GPU, no API key, no external service required. Downloads ~25MB to .model-cache/ on first run.\n\n'
    'Singleton pattern: _module, _pipe, _loading ensure the model is loaded exactly once '
    'even if multiple requests arrive before loading completes. _loading holds the in-flight '
    'promise so concurrent callers await the same load operation.\n\n'
    'warmupEmbeddings() — called from main.ts after server start. Pre-loads the model '
    'in background so the first real request does not wait for the download.\n\n'
    'generateEmbedding(text) — runs text through the pipeline with '
    'pooling:mean and normalize:true. Returns Float32Array as number[] (384 values).\n\n'
    'cosineSimilarity(a, b) — dot product of two L2-normalised vectors. '
    'Since normalize:true ensures |v|=1, dot product equals cosine similarity '
    '(range 0 to 1 for similar texts).'
)
pdf.code(
    '// Why dot product = cosine similarity:\n'
    '// cos(a, b) = (a · b) / (|a| * |b|)\n'
    '// when |a| = |b| = 1 (normalized): cos(a, b) = a · b\n\n'
    'export function cosineSimilarity(a: number[], b: number[]): number {\n'
    '  let dot = 0;\n'
    '  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];\n'
    '  return dot;\n'
    '}',
    'embeddings.ts — cosineSimilarity'
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 6 — ANALYTICS MODULE
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('6', 'Analytics Module', 'The main request handler — controller, service, pipeline service')

pdf.file_header('analytics/analytics.controller.ts', 'HTTP layer — two routes, DTO validation, user ID extraction')
pdf.body(
    'Routes:\n\n'
    'GET /api/provider — public, returns { provider: "groq", hasGlobalKey: bool }. '
    'The frontend uses hasGlobalKey to decide whether to prompt the user for their own key.\n\n'
    'POST /api/analytics — the main endpoint. Accepts AnalyticsDto:\n'
    '  • prompt (string, 1-1000 chars, required)\n'
    '  • intent (string, optional) — "dashboard", "report", "inquiry", or omit for free-text\n'
    '  • sessionId (string, optional) — resume an existing conversation\n\n'
    'The x-user-id header is required on POST. requireUserId() throws 401 if missing. '
    'HttpExceptions propagate directly; other errors are wrapped in 500.'
)

pdf.file_header('analytics/analytics.service.ts', 'Orchestrates the full request — API keys, session, memory, pipeline, response')
pdf.body(
    'The most complex service in the app. run() method flow:\n\n'
    '  1. promptSchema.parse() — Zod validates prompt length\n'
    '  2. ensureDataSources() — throws 400 if no sources are registered\n'
    '  3. resolveApiKeys() — loads user\'s stored key from MongoDB, falls back to global key\n'
    '  4. resolveSession() — resumes session if sessionId exists in LibSQL, else creates new UUID\n'
    '  5. buildMemoryContext() — loads last 6 messages + top 3 long-term memories\n'
    '  6. runWithFallback() → PipelineService.execute*()\n'
    '  7. If execution fails with 401/403 → retry with global key (per-user key deleted)\n'
    '  8. If execution fails with 429 → retry with global key or throw rate-limit error\n'
    '  9. buildResponse() — assembles HTTP response, saves turn, extracts memories (both async)\n\n'
    'The key fallback mechanism ensures users with invalid keys still get results if a '
    'global key is configured. Per-user keys are silently deleted when they fail.'
)
pdf.code(
    '// Simplified run() flow\n'
    'async run(req: AnalyticsRequest): Promise<AnalyticsResponse> {\n'
    '  const prompt = promptSchema.parse(req.prompt);\n'
    '  this.ensureDataSources();\n'
    '  const { primaryKey } = await this.resolveApiKeys(req.userId);\n'
    '  const { sessionId }  = await this.resolveSession(req);\n'
    '  const memCtx = await this.buildMemoryContext(req.userId, sessionId, prompt);\n'
    '  const { result } = await this.runWithFallback(req.intent, prompt, memCtx, ...);\n'
    '  return this.buildResponse({ result, prompt, sessionId, ... }); // fires memory async\n'
    '}',
    'analytics.service.ts — run() simplified'
)

pdf.file_header('analytics/pipeline.service.ts', 'Core AI pipeline — aggregate() + executeDashboard/Report/Inquiry()')
pdf.body(
    'The NestJS injectable pipeline orchestrator. Uses @InjectConnection() for the '
    'Mongoose connection and injects CacheService, HistoryService, ChartResultsRepository.\n\n'
    'aggregate(prompt, intent, context, apiKey):\n'
    '  1. CacheService.getCached() — skip LLM if identical prompt was answered before\n'
    '  2. runSupervisorPlan() — LLM Call #1 → TaskPlan\n'
    '  3. resolvePipeline() — validates pipeline safety (no $function/$merge/$out), '
    'finds collection name\n'
    '  4. runAggregation() — Mongoose connection runs the pipeline with maxTimeMS guard\n'
    '  5. flush() — writes to cache + history (both fire-and-forget)\n\n'
    'executeDashboard() → aggregate() → runChart()\n'
    'executeReport()    → aggregate() → runReportSkill() + optional runChart() in parallel\n'
    'executeInquiry()   → aggregate() → runInquirySkill()\n\n'
    'Dashboard also checks a "full" cache key that stores the complete rendered spec '
    '(skipping both LLM calls on cache hit).'
)

pdf.info_box(
    'SECURITY: Forbidden Pipeline Stages',
    'The following MongoDB stages are blocked to prevent data exfiltration or '
    'side effects: $function, $merge, $out, $where, $eval. '
    'Any plan containing these throws an error before execution.',
    C_WARN
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 7 — REQUEST FLOW
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('7', 'Full Request Flow', 'Step-by-step trace of POST /api/analytics')

pdf.section('Happy Path — Dashboard Request')
pdf.body('Trace of: POST /api/analytics { prompt: "show spending by city", intent: "dashboard" }')
pdf.flow_step(1,  'RequestIdMiddleware',      'Assigns UUID to AsyncLocalStorage')
pdf.flow_step(2,  'ApiKeyGuard',              'Validates x-api-key header')
pdf.flow_step(3,  'ValidationPipe (DTO)',     'Checks prompt 1-1000 chars, types')
pdf.flow_step(4,  'AnalyticsController',      'Extracts x-user-id header')
pdf.flow_step(5,  'AnalyticsService.run()',   'Starts orchestration')
pdf.flow_step(6,  'UserKeysService.get()',    'Loads user Groq API key from MongoDB')
pdf.flow_step(7,  'sessionExists() / UUID',  'Resolves or creates session ID')
pdf.flow_step(8,  'getMemoryContext()',       'Loads last 6 messages from LibSQL')
pdf.flow_step(9,  'getRelevantContext()',     'Finds top 3 semantic memories from MongoDB')
pdf.flow_step(10, 'PipelineService',         'executeDashboard() called')
pdf.flow_step(11, 'CacheService.getCached()','SHA-256 key lookup in MongoDB (miss)')
pdf.flow_step(12, 'runSupervisorPlan()',     'LLM #1: prompt → MongoDB pipeline (Groq)')
pdf.flow_step(13, 'runAggregation()',        'Mongoose runs pipeline against data collection')
pdf.flow_step(14, 'runChart()',              'LLM #2: rows → widget plans (Groq)')
pdf.flow_step(15, 'Chart renderers',         'Deterministic code builds ECharts configs')
pdf.flow_step(16, 'CacheService.setCached()','Saves full dashboard spec (7-day TTL)')
pdf.flow_step(17, 'HistoryService.save()',   'Logs run to results_history collection')
pdf.flow_step(18, 'buildResponse()',         'Assembles HTTP response JSON')
pdf.flow_step(19, 'saveConversationTurn()',  'Saves to LibSQL session (fire-and-forget)')
pdf.flow_step(20, 'extractAndSave()',        'LLM #3: memory extraction (fire-and-forget)')
pdf.body('\nTotal LLM calls: 2 blocking (#1 supervisor, #2 chart) + 1 background (#3 memory)')

pdf.section('Free-Text Routing (no intent)')
pdf.body(
    'When no intent is provided, AnalyticsService calls analyticsAgent.generateLegacy() '
    '(the Mastra agent in session/agent.ts). The agent has 3 tools:\n'
    '  buildDashboard, generateReport, executeInquiry\n\n'
    'The Supervisor LLM reads the prompt and the tool descriptions, then decides which '
    'tool to call. This adds one extra LLM call at the start. '
    'The agent tools call the standalone functions in features/ (not PipelineService) '
    'because Mastra tools are not inside the NestJS DI container.'
)

pdf.section('Cache Hit Path (repeated prompt)')
pdf.body(
    'If the exact same prompt+intent was already answered and is within 7 days:\n\n'
    '  CacheService.getCached() → cache hit → return cached result\n\n'
    'Zero LLM calls. Zero MongoDB aggregation. The cache key is a 24-character prefix '
    'of SHA-256("intent:normalized_prompt"). The prompt is lowercased and whitespace-'
    'normalized before hashing so minor variations still hit the cache.'
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 8 — SESSION & MEMORY
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('8', 'Session & Memory', 'Short-term conversation threads + long-term semantic memory')

pdf.section('Two Memory Systems')
pdf.two_col_table(
    ['System', 'Details'],
    [
        ('Short-term (LibSQL)',   'Last 6 messages per session, stored in SQLite file ./data/memory.db'),
        ('Short-term (LibSQL)',   'Managed by Mastra Memory library via LibSQLStore adapter'),
        ('Short-term (LibSQL)',   'Scoped to sessionId (UUID) — cleared when session is deleted'),
        ('Long-term (MongoDB)',   'Structured memory items extracted by LLM from each turn'),
        ('Long-term (MongoDB)',   'Stored in memory_items collection with embedding vectors'),
        ('Long-term (MongoDB)',   'Retrieved by cosine similarity of current prompt vs stored embeddings'),
        ('Long-term (MongoDB)',   'Persists across sessions — never auto-deleted'),
    ]
)

pdf.file_header('session/memory.ts', 'Short-term conversation memory — LibSQL via Mastra Memory library')
pdf.body(
    'Key exported functions:\n\n'
    'ensureThread(threadId, title, intent) — creates thread in LibSQL if not exists, '
    'updates title/metadata if it already exists. Silent on failure.\n\n'
    'getMemoryContext(threadId) — retrieves last 6 messages via memory.getContext(), '
    'converts Mastra format to Vercel AI SDK CoreMessage[] format for LLM injection.\n\n'
    'saveConversationTurn({ threadId, prompt, intent, assistant }) — saves two messages '
    '(user + assistant) to LibSQL. Each message stores both plain text (for Mastra) and '
    'a structured uiMessage in metadata (for the history API to reconstruct conversations).\n\n'
    'listSessions() / getSessionDetail(id) / deleteSession(id) — session management '
    'API backed by Mastra\'s thread storage.\n\n'
    'The RESOURCE_ID constant ("mindai") is used as a namespace in Mastra\'s storage '
    'so threads from different apps don\'t collide if sharing the same SQLite file.'
)
pdf.code(
    '// How a message is stored (simplified)\n'
    '{\n'
    '  id: randomUUID(),\n'
    '  role: "user",\n'
    '  threadId: sessionId,\n'
    '  content: {\n'
    '    format: 2,\n'
    '    parts: [{ type: "text", text: "show spending by city" }],\n'
    '    metadata: {\n'
    '      uiMessage: { messageId, role: "user", prompt, intent, createdAt }\n'
    '    }\n'
    '  }\n'
    '}',
    'session/memory.ts — message storage format'
)

pdf.file_header('session/agent.ts', 'Mastra Agent — free-text routing when no intent is provided')
pdf.body(
    'Creates a Mastra Agent with the "supervisor" LLM model and 3 registered tools. '
    'Used only when the user sends a prompt without specifying an intent.\n\n'
    'Tools:\n'
    '  buildDashboard — calls features/dashboard.executeDashboard()\n'
    '  generateReport — calls features/report.executeReport()\n'
    '  executeInquiry — calls features/inquiry.executeInquiry()\n\n'
    'The agent\'s instructions (system prompt) are read from skills/analytics/SKILL.md. '
    'MAX_AGENT_STEPS=2 limits how many tool calls the agent can make in one turn. '
    'analyticsAgent.generateLegacy() is called with the user message and returns '
    'the tool result from whichever tool the LLM chose.'
)

pdf.file_header('memory/memory.schema.ts', 'Mongoose schema for long-term memory items')
pdf.body(
    'Collection: memory_items. Fields:\n\n'
    '  userId (indexed)   — scopes all memories to one user\n'
    '  sessionId          — which session the memory came from\n'
    '  type               — goal | insight | preference | context | decision\n'
    '  content            — the actual memory text (5-300 chars)\n'
    '  tags[]             — keyword strings for fallback retrieval\n'
    '  importance         — integer 1-5 (5 = most important, recalled first)\n'
    '  embedding[]        — 384 floats from all-MiniLM-L6-v2 (for semantic search)\n\n'
    'Two compound indexes:\n'
    '  { userId, importance DESC, createdAt DESC } — for ranked listing\n'
    '  { userId, tags } — for tag-based fallback search'
)

pdf.file_header('memory/memory.repository.ts', 'MongoDB CRUD for memories with semantic retrieval')
pdf.body(
    'upsert(items[]) — for each item:\n'
    '  1. Generates embedding via generateEmbedding(content)\n'
    '  2. Checks for existing similar memory (first 60 chars fingerprint match)\n'
    '  3. Updates if exists (refreshes content, tags, importance, embedding)\n'
    '  4. Creates if new\n\n'
    'findRelevant(userId, promptText, limit) — semantic retrieval:\n'
    '  1. Loads up to 100 memories for the user (sorted by importance + recency)\n'
    '  2. Generates embedding of the current promptText\n'
    '  3. If model ready: scores each memory by cosine similarity\n'
    '  4. Fallback if model not ready: keyword overlap score + importance/20 bonus\n'
    '  5. Returns top N by score\n\n'
    'listByUser() — returns all memories without the embedding field (too large for API)\n'
    'deleteByUser() — clears all memories for a user'
)

pdf.file_header('memory/memory.service.ts', 'Memory service — getRelevantContext() + extractAndSave()')
pdf.body(
    'getRelevantContext(userId, prompt) — called before every LLM call. '
    'Fetches the top 3 semantically relevant memories and formats them as:\n'
    '  [INSIGHT] User prefers budget breakdowns by municipality\n'
    '  [GOAL] Monitoring road infrastructure projects in northern regions\n'
    'This string is injected into the conversation context as a synthetic "user" message '
    'before the real history, giving the Supervisor LLM long-term context.\n\n'
    'extractAndSave(userId, sessionId, prompt, summary, apiKey) — fires after every '
    'response. Calls extractMemories() (LLM), then calls repo.upsert(). '
    'Any failure is caught and logged as a warning — never blocks the response.'
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 9 — REMAINING MODULES
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('9', 'Remaining Modules', 'Cache, History, Sources, User Keys, Saved Results, Prompts')

pdf.section('Cache Module')
pdf.file_header('cache/cache.service.ts', 'Injectable prompt cache — SHA-256 keyed, 7-day TTL in MongoDB')
pdf.body(
    'cacheKey(intent, prompt) — generates a 24-char SHA-256 prefix from '
    '"intent:lowercased_normalized_prompt". Minor whitespace differences in prompts '
    'still hit the same cache entry.\n\n'
    'getCached<T>(intent, prompt) — findOneAndUpdate() with $inc on hitCount and '
    '$set on lastHitAt. Returns the result field cast to T, or null on miss.\n\n'
    'setCached<T>(intent, prompt, result) — replaceOne with upsert:true. '
    'Overwrites if key exists. The TTL is enforced by a MongoDB TTL index on '
    'createdAt (7 days = 604800 seconds).\n\n'
    'list() — returns all cache entries (without result field — too large) sorted by lastHitAt.\n'
    'deleteEntry(key) / clearAll() — cache management API endpoints.'
)

pdf.file_header('cache/prompt-cache.ts', 'Standalone cache functions — used only by Mastra agent fallback path')
pdf.body(
    'Identical logic to CacheService but implemented as plain async functions using '
    'mongoose.connection.db (the raw connection, not @InjectModel). '
    'Used by features/pipeline.ts which is called from session/agent.ts (Mastra tools '
    'are not inside NestJS DI, so they cannot inject CacheService).'
)

pdf.section('History Module')
pdf.file_header('history/results-history.repository.ts', 'Saves and queries pipeline run history in MongoDB')
pdf.body(
    'Collection: results_history (via PipelineRun Mongoose schema).\n\n'
    'save(entry) — creates a document with prompt, intent, collection, pipeline stages, '
    'rows, rowCount, and durationMs. Returns the MongoDB _id as a hex string.\n\n'
    'list(filter) — paginated query with optional intent filter. '
    'Max 100 results per page. Sorted by createdAt DESC.\n\n'
    'findById(id) — validates the id is a valid 24-char MongoDB ObjectId hex before querying.\n\n'
    'count(filter) — used to return total count alongside paginated results.'
)

pdf.file_header('history/history.service.ts + history.controller.ts', 'API layer for history and sessions')
pdf.body(
    'HistoryService wraps the repository and also delegates to session/memory.ts for '
    'session-related operations. This keeps the controller clean.\n\n'
    'Routes:\n'
    '  GET /api/history/results          — list runs (pagination: skip, limit, intent filter)\n'
    '  GET /api/history/results/:id      — full detail (includes pipeline stages and rows)\n'
    '  GET /api/history/sessions         — list all conversation sessions\n'
    '  GET /api/history/sessions/:id     — one session with full message history\n'
    '  DELETE /api/history/sessions/:id  — permanently delete a session'
)

pdf.section('Sources Module')
pdf.file_header('sources/sources-cache.ts + source.repository.ts', 'In-memory source cache and normalizeToken()')
pdf.body(
    'sources-cache.ts: A module-level DataSource[] array. getSources() and setSourcesCache() '
    'are the only API. Zero MongoDB hits per request — the array is loaded once at startup '
    'and updated synchronously whenever a source is added/removed.\n\n'
    'source.repository.ts: contains normalizeToken(s) — converts strings to lowercase '
    'alphanumeric. This lets "My Source", "my_source", "MY SOURCE" all match the same '
    'registered collection.'
)

pdf.file_header('sources/sources.service.ts', 'Source registry — loads on startup, CRUD, generates example prompts')
pdf.body(
    'Implements OnModuleInit — calls reloadCache() on app startup so sources are available '
    'before the first HTTP request.\n\n'
    'getMeta() — for each registered source, generates example prompts for all 3 intents. '
    'Used by GET /api/meta (no auth required) so the frontend can show prompt suggestions.\n\n'
    'register(source) — upsert by collection name, then reload cache.\n'
    'remove(collection) — delete by collection, reload cache.'
)

pdf.section('User Keys Module')
pdf.file_header('user-keys/user-keys.service.ts', 'Stores per-user Groq API keys in MongoDB')
pdf.body(
    'Collection: user_api_keys. One document per userId, with apiKey field.\n\n'
    'save(userId, apiKey) — findOneAndUpdate with upsert:true.\n'
    'get(userId) — returns the stored key or null.\n'
    'delete(userId) — removes the document. Called automatically by AnalyticsService '
    'when a user\'s key is rejected by Groq (invalid key).'
)

pdf.section('Saved Results Module')
pdf.file_header('saved-results/*.ts', 'User-saved report/dashboard snapshots')
pdf.body(
    'Allows users to bookmark specific analytics results. All operations are scoped to userId.\n\n'
    'Routes (via SavedResultsController):\n'
    '  GET    /api/saved-results         — list user\'s saved items\n'
    '  GET    /api/saved-results/:id     — one saved item\n'
    '  POST   /api/saved-results         — save a result\n'
    '  DELETE /api/saved-results/:id     — remove a saved result'
)

pdf.section('Prompts')
pdf.file_header('prompts/planner.prompt.ts', 'Builds Supervisor system prompt with full schema injected')
pdf.body(
    'buildPlannerPrompt(intent, sources) — generates the system prompt for LLM Call #1. '
    'It injects the name, description, collection name, and field definitions of every '
    'registered DataSource. This is how the LLM knows what data is available to query. '
    'The prompt also specifies the required output format, forbidden pipeline stages, '
    'and intent-specific instructions (e.g. for dashboard: include strategy and chartHint).'
)
pdf.file_header('prompts/chart.prompt.ts', 'Builds chart LLM message with data sample')
pdf.body(
    'buildChartPrompt(rows, prompt, strategy, chartHint, source) — builds the user message '
    'for LLM Call #2 (chart). Includes: the first CHART_SAMPLE_ROWS rows as JSON, '
    'field types inferred from the data, available chart types, the layout options, '
    'the strategy hint from the Supervisor, and the original prompt. '
    'All available in one message so the LLM can make informed widget choices.'
)
pdf.file_header('prompts/writer.prompt.ts', 'Builds messages for inquiry and report LLM calls')
pdf.body(
    'buildInquiryMessage(prompt, rows, maxRows, maxChars) — formats data rows as text '
    '(truncated to maxChars) and adds the original question. '
    'buildReportMessage(prompt, rows, maxChars, withChart) — same but includes a hint '
    'about whether a chart accompanies the report so the writer can adjust prose.'
)

pdf.section('Types')
pdf.file_header('types/index.ts', 'All shared TypeScript interfaces')
pdf.two_col_table(
    ['Type / Interface', 'Description'],
    [
        ('DataSource',           'A registered data collection: name, collection, description, fields[]'),
        ('DataSourceField',      'One field: name, type, description, enum values, referencing info'),
        ('DataSourceJoin',       'Cross-collection join definition'),
        ('IntentKind',           '"dashboard" | "report" | "general_question"'),
        ('SkillKind',            '"aggregation" | "chart" | "report" | "inquiry"'),
        ('TaskPlan',             'LLM #1 output: needsData, pipeline[], skills[], strategy, chartHint'),
        ('DashboardSpec',        'Final dashboard: layout, title, summary, widgets[]'),
        ('WidgetSpec',           'One chart widget: id, type, title, insight, option (ECharts)'),
        ('WidgetType',           'All 15 chart type strings (bar_chart, donut_chart, etc.)'),
        ('FieldType',            'string|number|integer|date|enum|reference|array|object|geo|text'),
        ('ChartHint',            'Hint string from supervisor to guide chart selection'),
    ]
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 10 — ENVIRONMENT VARIABLES
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('10', 'Environment Variables', 'Complete reference for all configuration options')

pdf.section('Required Variables')
pdf.two_col_table(
    ['Variable', 'Description'],
    [
        ('MONGODB_URI',    'MongoDB connection string e.g. mongodb://127.0.0.1:27017/mind_platform'),
        ('MONGODB_DB',     'Database name e.g. mind_platform'),
    ]
)

pdf.section('LLM Configuration')
pdf.two_col_table(
    ['Variable', 'Default / Description'],
    [
        ('GROQ_API_KEY',          'Global Groq API key (optional if all users provide their own)'),
        ('GROQ_MODEL',            'llama-3.3-70b-versatile — default for all roles'),
        ('GROQ_SUPERVISOR_MODEL', 'Override model for the Supervisor role'),
        ('GROQ_CHART_MODEL',      'Override model for the Chart role'),
        ('GROQ_WRITER_MODEL',     'Override model for the Writer role'),
        ('GROQ_MEMORY_MODEL',     'Override model for memory extraction (default: llama-3.1-8b-instant)'),
        ('SUPERVISOR_TIMEOUT_MS', '8000 — abort supervisor LLM call after N ms'),
        ('CHART_TIMEOUT_MS',      '8000 — abort chart LLM call after N ms'),
        ('WRITER_TIMEOUT_MS',     '8000 — abort writer/memory LLM call after N ms'),
    ]
)

pdf.section('Server Configuration')
pdf.two_col_table(
    ['Variable', 'Default / Description'],
    [
        ('PORT',                  '3001 — HTTP port for the NestJS app'),
        ('NODE_ENV',              'production | development'),
        ('ALLOWED_ORIGINS',       'Comma-separated CORS origins (empty = allow all)'),
        ('API_KEY',               'Optional server-level auth key (x-api-key header)'),
        ('SHUTDOWN_TIMEOUT_MS',   '10000 — graceful shutdown window'),
    ]
)

pdf.section('Tuning Variables (optional)')
pdf.two_col_table(
    ['Variable', 'Default / Description'],
    [
        ('MONGODB_SERVER_SELECTION_TIMEOUT_MS', '8000 — MongoDB connection timeout'),
        ('MONGODB_CONNECT_RETRIES',             '1 — how many times to retry connecting'),
        ('MONGODB_PIPELINE_TIMEOUT_MS',         '30000 — max time for MongoDB aggregation'),
        ('CHART_MAX_WIDGETS',                   '3 — max widgets per dashboard'),
        ('CHART_MAX_TOKENS',                    '1000 — token limit for chart LLM call'),
        ('CHART_SAMPLE_ROWS',                   '8 — rows sent to chart LLM as sample'),
        ('INQUIRY_MAX_TOKENS',                  '400 — token limit for inquiry responses'),
        ('INQUIRY_MAX_ROWS',                    '10 — rows sent to inquiry writer'),
        ('REPORT_MAX_TOKENS',                   '900 — token limit for report responses'),
        ('WRITER_MAX_CHARS',                    '8000 — max data characters sent to writer'),
        ('PLANNER_MAX_TOKENS',                  '600 — token limit for supervisor plan'),
        ('LIBSQL_URL',                          'file:./data/memory.db — LibSQL connection'),
        ('TRACE',                               '1 — enable verbose JSON dumps in logs'),
        ('DEBUG',                               '1 — enable debug log level'),
    ]
)

# ══════════════════════════════════════════════════════════════════════════════
# CHAPTER 11 — KEY DESIGN DECISIONS
# ══════════════════════════════════════════════════════════════════════════════
pdf.chapter_title('11', 'Key Design Decisions', 'Why the code is structured the way it is')

pdf.two_col_table(
    ['Decision', 'Reason'],
    [
        ('Hybrid LLM + Deterministic charts',
         'LLM picks chart types; pure code renders them. Avoids hallucinated ECharts configs.'),
        ('In-memory source cache',
         'Zero DB reads per request for schema. Sources rarely change, load once at startup.'),
        ('7-day prompt cache',
         'Identical prompts skip both LLM calls. SHA-256 key + normalized prompt for robustness.'),
        ('Global APP_GUARD',
         'Security check cannot be forgotten on new routes — it applies by default.'),
        ('AsyncLocalStorage for request ID',
         'No need to thread requestId through every function parameter.'),
        ('Fire-and-forget for memory/history',
         'Memory extraction and history logging never delay the HTTP response.'),
        ('API key fallback mechanism',
         'Users with expired keys still work if a global key is configured.'),
        ('Forbidden pipeline stages',
         '$merge/$out/$function blocked to prevent data corruption or RCE.'),
        ('Local embedding model (WASM)',
         'No API cost, no external dependency, works offline. 25MB one-time download.'),
        ('Memory extracted by small model',
         'llama-3.1-8b-instant is fast/cheap for extraction. 70B model reserved for queries.'),
        ('Two memory systems',
         'LibSQL for short-term (fast, local), MongoDB for long-term (persistent, semantic).'),
        ('Two pipeline paths (DI + standalone)',
         'NestJS DI path for normal requests; standalone functions for Mastra agent tools.'),
    ]
)

pdf.output(OUTPUT)
print(f"PDF saved to: {OUTPUT}")
