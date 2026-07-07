import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

const MB = 1024 * 1024;

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // §7 README: memory backend (heap vs RSS terpisah). Node melaporkan RSS asli
  // lewat process.memoryUsage(), jadi ini akurat (bukan estimasi).
  @Get('metrics')
  getMetrics() {
    const mem = process.memoryUsage();
    return {
      rssMB: Math.round((mem.rss / MB) * 100) / 100,
      heapUsedMB: Math.round((mem.heapUsed / MB) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / MB) * 100) / 100,
      externalMB: Math.round((mem.external / MB) * 100) / 100,
    };
  }
}
