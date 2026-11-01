import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { DropoutEvent, OrderResolution } from './operations';

export interface TraceDecision {
  orderId: string | null;
  orderSourceRow: number;
  subscriberId: string | null;
  subscriberName: string;
  mealType: string | null;
  outcome: OrderResolution['outcome'];
  backupCookId: string | null;
  backupCookName: string | null;
  reason: string;
}

export interface TraceNotification {
  subscriberId: string | null;
  subscriberName: string;
  message: string;
  status: 'Sent';
}

export interface TraceabilityRecord {
  id: string;
  eventDate: string;
  cookNames: string[];
  sources: DropoutEvent['sources'];
  decisions: TraceDecision[];
  notifications: TraceNotification[];
  recordedAt: string;
}

const STORAGE_KEY = 'tiffinloop.traceability.v1';

@Injectable({ providedIn: 'root' })
export class TraceabilityService {
  private readonly platformId = inject(PLATFORM_ID);
  readonly records = signal<TraceabilityRecord[]>(this.readStoredRecords());

  record(record: TraceabilityRecord): void {
    if (this.records().some((existing) => existing.id === record.id)) return;
    const updated = [record, ...this.records()];
    this.records.set(updated);

    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
      }
    }
  }

  private readStoredRecords(): TraceabilityRecord[] {
    if (!isPlatformBrowser(this.platformId)) return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed: unknown = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed as TraceabilityRecord[] : [];
    } catch {
      return [];
    }
  }
}