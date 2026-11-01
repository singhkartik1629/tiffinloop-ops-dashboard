import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { DataService } from '../data.service';

interface FrequencyRow {
  label: string;
  city?: string;
  count: number;
  lastEvent: string;
}

@Component({
  selector: 'app-leadership-dashboard',
  templateUrl: './leadership-dashboard.html',
  styleUrl: './leadership-dashboard.css',
})
export class LeadershipDashboard {
  private readonly dataService = inject(DataService);
  readonly data = toSignal(
    this.dataService.loadData().pipe(catchError(() => of(null))),
    { initialValue: null },
  );
  readonly endDate = computed(() => this.data()?.operationalDate ?? '');
  readonly startDate = computed(() => {
    const end = this.endDate();
    if (!end) return '';
    const date = new Date(`${end}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  });
  readonly rangeLabel = computed(() =>
    this.startDate() && this.endDate()
      ? `${this.formatDate(this.startDate())} – ${this.formatDate(this.endDate())}`
      : 'Date range unavailable',
  );
  readonly recentEvents = computed(() =>
    (this.data()?.dropoutEvents ?? []).filter(
      (event) => event.date >= this.startDate() && event.date <= this.endDate(),
    ),
  );
  readonly cityRows = computed<FrequencyRow[]>(() => {
    const counts = new Map<string, { count: number; lastEvent: string }>();
    for (const event of this.recentEvents()) {
      const city = event.city ?? 'Unknown city';
      const current = counts.get(city) ?? { count: 0, lastEvent: '' };
      counts.set(city, {
        count: current.count + 1,
        lastEvent: event.date > current.lastEvent ? event.date : current.lastEvent,
      });
    }
    return [...counts.entries()]
      .map(([label, row]) => ({ label, ...row }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  });
  readonly cookRows = computed<FrequencyRow[]>(() => {
    const counts = new Map<string, FrequencyRow>();
    for (const event of this.recentEvents()) {
      const current = counts.get(event.cookId) ?? {
        label: event.cookName,
        city: event.city ?? 'Unknown city',
        count: 0,
        lastEvent: '',
      };
      counts.set(event.cookId, {
        ...current,
        count: current.count + 1,
        lastEvent: event.date > current.lastEvent ? event.date : current.lastEvent,
      });
    }
    return [...counts.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    );
  });
  readonly cityCount = computed(() => this.cityRows().length);
  readonly cookCount = computed(() => this.cookRows().length);

  barWidth(count: number, rows: FrequencyRow[]): string {
    const max = Math.max(...rows.map((row) => row.count), 0);
    return max ? `${(count / max) * 100}%` : '0%';
  }

  formatDate(date: string): string {
    if (!date) return '—';
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  }
}