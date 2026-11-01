import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { CleanData, DataService } from '../data.service';
import { DropoutEvent, OrderResolution, resolveOrdersForDate } from '../operations';
import {
  TraceNotification,
  TraceabilityRecord,
  TraceabilityService,
} from '../traceability.service';

interface EventDayOption {
  date: string;
  cookNames: string[];
  orderCount: number;
}

const VISIBLE_ORDER_STATUSES = new Set([
  'pending',
  'in_progress',
  'cook_failure',
  'ambiguous',
  'cancelled',
  'refunded',
]);

@Component({
  selector: 'app-ops-dashboard',
  templateUrl: './ops-dashboard.html',
  styleUrl: './ops-dashboard.css',
})
export class OpsDashboard {
  private readonly dataService = inject(DataService);
  private readonly traceability = inject(TraceabilityService);
  readonly loadError = signal(false);
  readonly data = toSignal(
    this.dataService.loadData().pipe(
      catchError(() => {
        this.loadError.set(true);
        return of(null);
      }),
    ),
    { initialValue: null as CleanData | null },
  );
  readonly selectedEventDate = signal('');
  readonly simulatedMessages = signal<TraceNotification[]>([]);
  readonly history = this.traceability.records;
  readonly operatingDate = computed(() => this.data()?.operationalDate ?? '');
  readonly operatingDateLabel = computed(() =>
    this.formatDate(this.operatingDate()),
  );

  readonly eventDays = computed<EventDayOption[]>(() => {
    const data = this.data();
    if (!data) return [];

    const byDate = new Map<string, DropoutEvent[]>();
    for (const event of data.dropoutEvents) {
      const group = byDate.get(event.date) ?? [];
      group.push(event);
      byDate.set(event.date, group);
    }

    return [...byDate.entries()]
      .map(([date, events]) => {
        const cookIds = new Set(events.map((event) => event.cookId));
        return {
          date,
          cookNames: [...new Set(events.map((event) => event.cookName))].sort(),
          orderCount: data.orders.filter(
            (order) =>
              order.date === date &&
              Boolean(order.cookId && cookIds.has(order.cookId)) &&
              VISIBLE_ORDER_STATUSES.has(order.status ?? ''),
          ).length,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  });
  readonly activeDate = computed(
    () => this.selectedEventDate() || this.eventDays()[0]?.date || this.operatingDate(),
  );
  readonly activeEvents = computed(() =>
    this.data()?.dropoutEvents.filter((event) => event.date === this.activeDate()) ?? [],
  );
  readonly resolutions = computed<OrderResolution[]>(() => {
    const data = this.data();
    const date = this.activeDate();
    if (!data || !date) return [];
    return resolveOrdersForDate(
      date,
      data.dropoutEvents,
      data.cooks,
      data.subscribers,
      data.orders,
      '10:30',
    );
  });
  readonly confirmedRecord = computed(() =>
    this.history().find((record) => record.id === this.recordId(this.activeDate())) ?? null,
  );
  readonly reporters = computed(() => {
    const unique = new Set(this.activeEvents().flatMap((event) =>
      event.sources.map((source) => source.reporter),
    ));
    return [...unique];
  });
  readonly sources = computed(() =>
    this.activeEvents().flatMap((event) => event.sources),
  );
  readonly reassignedCount = computed(() =>
    this.resolutions().filter((resolution) => resolution.outcome === 'reassigned').length,
  );
  readonly refundCount = computed(() =>
    this.resolutions().filter((resolution) => resolution.outcome === 'refund').length,
  );
  readonly needsOpsCount = computed(() =>
    this.resolutions().filter((resolution) => resolution.outcome === 'needs_ops').length,
  );

  onEventDateChange(event: Event): void {
    this.simulatedMessages.set([]);
    this.selectedEventDate.set((event.target as HTMLSelectElement).value);
  }

  confirmReassignment(): void {
    const resolutions = this.resolutions();
    const bySubscriber = new Map<string, TraceNotification>();
    for (const resolution of resolutions) {
      if (!resolution.subscriber?.id || bySubscriber.has(resolution.subscriber.id)) continue;
      const name = resolution.subscriber.name ?? 'there';
      bySubscriber.set(resolution.subscriber.id, {
        subscriberId: resolution.subscriber.id,
        subscriberName: resolution.subscriber.name ?? 'Subscriber',
        message: resolution.outcome === 'reassigned'
          ? `Hi ${name}, your meal today has been reassigned to ${resolution.backupCook?.name ?? 'a backup cook'}. Thank you for your understanding.`
          : `Hi ${name}, we’re sorry we couldn’t arrange a backup cook for your meal today. We’ll issue a refund for today’s meal. We apologize for the inconvenience.`,
        status: 'Sent',
      });
    }

    const notifications = [...bySubscriber.values()];
    this.simulatedMessages.set(notifications);
    const record: TraceabilityRecord = {
      id: this.recordId(this.activeDate()),
      eventDate: this.activeDate(),
      cookNames: [...new Set(this.activeEvents().map((event) => event.cookName))],
      sources: this.sources(),
      decisions: resolutions.map((resolution) => ({
        orderId: resolution.order.id,
        orderSourceRow: resolution.order.sourceRow,
        subscriberId: resolution.order.subscriberId,
        subscriberName: resolution.subscriber?.name ?? 'Unknown subscriber',
        mealType: resolution.order.mealType,
        outcome: resolution.outcome,
        backupCookId: resolution.backupCook?.id ?? null,
        backupCookName: resolution.backupCook?.name ?? null,
        reason: resolution.reason,
      })),
      notifications,
      recordedAt: new Date().toISOString(),
    };
    this.traceability.record(record);
  }

  sourceLabel(event: DropoutEvent): string {
    const types = [...new Set(event.sources.map((source) => source.type))];
    return types.map((type) => type === 'sheet' ? 'Cook sheet' : type === 'whatsapp' ? 'WhatsApp' : 'Order log').join(' + ');
  }

  traceSources(record: TraceabilityRecord): string {
    return record.sources
      .map((source) => `${source.type} row ${source.sourceRow} (${source.reporter})`)
      .join('; ');
  }

  private recordId(date: string): string {
    return `dropout-day:${date}`;
  }

  private formatDate(date: string): string {
    if (!date) return 'No event date';
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  }
}