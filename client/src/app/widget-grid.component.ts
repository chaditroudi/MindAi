import {
  AfterViewChecked,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  QueryList,
  ViewChildren,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartRenderService } from './chart-render.service';
import type { WidgetSpec } from './app.types';

const WIDGET_TYPE_LABELS: Record<string, string> = {
  table:                'Table',
  kpi_card:             'KPI',
  line_chart:           'Trend',
  area_chart:           'Area',
  multi_line_chart:     'Multi-line',
  bar_chart:            'Bars',
  horizontal_bar_chart: 'Ranking',
  grouped_bar_chart:    'Grouped',
  stacked_bar_chart:    'Stacked',
  donut_chart:          'Share',
  scatter_plot:         'Scatter',
  gauge_chart:          'Gauge',
  funnel_chart:         'Funnel',
  radar_chart:          'Radar',
  heatmap:              'Heatmap',
};

@Component({
  selector: 'app-widget-grid',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './widget-grid.component.html',
})
export class WidgetGridComponent implements AfterViewChecked, OnDestroy {
  @Input() widgets: WidgetSpec[] = [];
  @ViewChildren('chartHost') private chartHosts!: QueryList<ElementRef<HTMLDivElement>>;

  private readonly charts = inject(ChartRenderService);
  private readonly inited = new Set<string>();
  // Widget ids restart from "w1" on every response, so a plain id would collide
  // across different messages in the same ChartRenderService singleton — namespace
  // it per component instance so disposing one message's chart never touches another's.
  private readonly instanceKey = crypto.randomUUID();

  private renderKey(widgetId: string): string {
    return `${this.instanceKey}:${widgetId}`;
  }

  ngAfterViewChecked(): void {
    this.chartHosts.forEach(ref => {
      const el       = ref.nativeElement;
      const widgetId = el.getAttribute('data-widget-id');
      if (!widgetId || this.inited.has(widgetId)) return;
      const widget = this.widgets.find(w => w.id === widgetId);
      if (!widget?.option) return;
      this.charts.initWidget(el, { ...widget, id: this.renderKey(widget.id) });
      this.inited.add(widgetId);
    });
  }

  ngOnDestroy(): void {
    this.widgets.forEach(w => this.charts.dispose(this.renderKey(w.id)));
    this.inited.clear();
  }

  widgetTypeLabel(w: WidgetSpec): string {
    return WIDGET_TYPE_LABELS[w.type]
      ?? w.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  isChartWidget(w: WidgetSpec): boolean {
    return typeof w.option === 'object' && w.option !== null;
  }

  isKpiWidget(w: WidgetSpec): boolean {
    if (this.isChartWidget(w)) return false;
    return typeof w.value === 'number' || w.type === 'kpi_card';
  }

  isTableWidget(w: WidgetSpec): boolean {
    if (this.isChartWidget(w)) return false;
    return Array.isArray(w.columns) || Array.isArray(w.rows) || w.type === 'table';
  }
}
