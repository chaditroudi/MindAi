import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { CacheService } from '../src/cache/cache.service';

const API_KEY = 'test-api-key';

describe('App e2e (AI-independent modules)', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env['MONGODB_URI'] = mongod.getUri();
    process.env['API_KEY'] = API_KEY;

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await mongod.stop();
    delete process.env['API_KEY'];
  });

  describe('ApiKeyGuard', () => {
    it('blocks a protected route without x-api-key', async () => {
      await request(app.getHttpServer()).get('/api/cache').expect(401);
    });

    it('allows a protected route with the correct x-api-key', async () => {
      await request(app.getHttpServer())
        .get('/api/cache')
        .set('x-api-key', API_KEY)
        .expect(200);
    });

    it('allows public routes (health, meta) without x-api-key', async () => {
      await request(app.getHttpServer()).get('/health').expect((res) => {
        expect([200, 503]).toContain(res.status);
      });
      await request(app.getHttpServer()).get('/api/meta').expect(200);
    });
  });

  describe('health', () => {
    it('reports 503 with no sources registered', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ ok: false });
    });
  });

  describe('SourcesController', () => {
    const auth = () => ({ 'x-api-key': API_KEY });

    it('rejects registration missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/sources')
        .set(auth())
        .send({ name: 'Projects' })
        .expect(400);
      expect(res.body.error).toMatch(/name, collection, and at least one field/);
    });

    it('rejects a collection name that looks like a Mongo operator/system collection', async () => {
      await request(app.getHttpServer())
        .post('/api/sources')
        .set(auth())
        .send({
          name: 'Bad',
          collection: '$bad',
          fields: [{ name: 'x', type: 'string' }],
        })
        .expect(400);
    });

    it('rejects a field name starting with $', async () => {
      await request(app.getHttpServer())
        .post('/api/sources')
        .set(auth())
        .send({
          name: 'Bad',
          collection: 'bad',
          fields: [{ name: '$x', type: 'string' }],
        })
        .expect(400);
    });

    it('registers a source, lists it, then reports healthy', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/api/sources')
        .set(auth())
        .send({
          name: 'Projects',
          collection: 'projects',
          fields: [{ name: 'status', type: 'string' }],
        })
        .expect(201);
      expect(registerRes.body).toEqual({ ok: true, loaded: 1 });

      const listRes = await request(app.getHttpServer())
        .get('/api/sources')
        .set(auth())
        .expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toMatchObject({ name: 'Projects' });

      const healthRes = await request(app.getHttpServer()).get('/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body).toMatchObject({ ok: true, sources: 1 });
    });

    it('removes the source and 404s on a repeat delete', async () => {
      await request(app.getHttpServer())
        .delete('/api/sources/projects')
        .set(auth())
        .expect(200);

      await request(app.getHttpServer())
        .delete('/api/sources/projects')
        .set(auth())
        .expect(404);
    });
  });

  describe('CacheController', () => {
    const auth = () => ({ 'x-api-key': API_KEY });

    it('lists real cache entries written directly through CacheService', async () => {
      const cache = app.get(CacheService);
      await cache.setCached('inquiry', 'how many projects?', { summary: 'ok' });

      const res = await request(app.getHttpServer())
        .get('/api/cache')
        .set(auth())
        .expect(200);

      expect(res.body.count).toBe(1);
      expect(res.body.entries[0]).toMatchObject({ intent: 'inquiry' });
    });

    it('clears all entries', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/cache')
        .set(auth())
        .expect(200);
      expect(res.body).toMatchObject({ ok: true, deleted: 1 });

      const after = await request(app.getHttpServer())
        .get('/api/cache')
        .set(auth())
        .expect(200);
      expect(after.body.count).toBe(0);
    });
  });

  describe('SavedResultsController', () => {
    const auth = (userId: string) => ({
      'x-api-key': API_KEY,
      'x-user-id': userId,
    });

    it('requires x-user-id', async () => {
      await request(app.getHttpServer())
        .get('/api/saved')
        .set({ 'x-api-key': API_KEY })
        .expect(401);
    });

    it('rejects an invalid save payload via the real ValidationPipe', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/saved')
        .set(auth('user-1'))
        .send({ intent: 'dashboard' }) // missing required "title"
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    });

    it('requires a non-null result', async () => {
      await request(app.getHttpServer())
        .post('/api/saved')
        .set(auth('user-1'))
        .send({ title: 'My Dashboard', intent: 'dashboard' })
        .expect(400);
    });

    let savedId: string;

    it('saves a result scoped to the calling user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/saved')
        .set(auth('user-1'))
        .send({
          title: 'My Dashboard',
          intent: 'dashboard',
          result: { widgets: [] },
        })
        .expect(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.id).toEqual(expect.any(String));
      savedId = res.body.id;
    });

    it('lists the saved result for its owner but not for a different user', async () => {
      const mine = await request(app.getHttpServer())
        .get('/api/saved')
        .set(auth('user-1'))
        .expect(200);
      expect(mine.body).toHaveLength(1);

      const someoneElses = await request(app.getHttpServer())
        .get('/api/saved')
        .set(auth('user-2'))
        .expect(200);
      expect(someoneElses.body).toHaveLength(0);
    });

    it('404s fetching another user\'s saved result by id', async () => {
      await request(app.getHttpServer())
        .get(`/api/saved/${savedId}`)
        .set(auth('user-2'))
        .expect(404);
    });

    it('deletes the saved result and 404s on repeat delete', async () => {
      await request(app.getHttpServer())
        .delete(`/api/saved/${savedId}`)
        .set(auth('user-1'))
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/saved/${savedId}`)
        .set(auth('user-1'))
        .expect(404);
    });
  });
});
