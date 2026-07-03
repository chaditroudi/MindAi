import { AppModule } from '../app.module';
import { Test } from '@nestjs/testing';
describe('probe', () => { it('loads', async () => { await Test.createTestingModule({ imports: [AppModule] }); }); });
