import { Injectable } from '@angular/core';
import * as echarts from 'echarts';
import type { WidgetSpec } from './app.types';


@Injectable({ providedIn: 'root' })
export class ChartRenderService {
  private readonly instances = new Map<string, echarts.ECharts>();

  constructor() {
    window.addEventListener('resize', this.onWindowResize);
  }

  initWidget(el: HTMLElement, widget: WidgetSpec): void {
    if (!widget.option) return;
    this.dispose(widget.id);
    const chart = echarts.init(el);
    chart.setOption(widget.option as Parameters<typeof chart.setOption>[0], true);
    this.instances.set(widget.id, chart);
  }

  dispose(id: string): void {
    const chart = this.instances.get(id);
    if (chart) {
      chart.dispose();
      this.instances.delete(id);
    }
  }

  disposeAll(): void {
    this.instances.forEach(c => c.dispose());
    this.instances.clear();
  }

  private readonly onWindowResize = (): void => {
    this.instances.forEach(c => c.resize());
  };
}
