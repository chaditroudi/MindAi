import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import mongoose from 'mongoose';
import type { Response } from 'express';
import { getSources } from './sources/sources-cache';

@ApiTags('health')
@Controller()
export class AppController {
  @Get('health')
  async health(@Res() res: Response) {
    try {
      await mongoose.connection.db?.command({ ping: 1 });
      const sources = getSources();
      if (!sources.length) {
        res.status(503).json({
          ok: false,
          mongo: 'connected',
          sources: 0,
          detail: 'no data sources loaded',
        });
        return;
      }
      res
        .status(200)
        .json({ ok: true, mongo: 'connected', sources: sources.length });
    } catch {
      res.status(503).json({ ok: false, mongo: 'unavailable' });
    }
  }
}
