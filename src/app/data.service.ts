import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { forkJoin, map, shareReplay } from 'rxjs';
import {
  Cook,
  Order,
  Subscriber,
  WhatsappMessage,
  parseCooks,
  parseOrders,
  parseSubscribers,
  parseWhatsapp,
} from './parser';
import { DropoutEvent, buildDropoutEvents, getOperationalDate } from './operations';

export interface CleanData {
  cooks: Cook[];
  subscribers: Subscriber[];
  orders: Order[];
  whatsappMessages: WhatsappMessage[];
  dropoutEvents: DropoutEvent[];
  operationalDate: string | null;
}

@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);

  readonly data$ = forkJoin({
    cooks: this.http.get('/assets/data/cooks.csv', { responseType: 'text' }),
    subscribers: this.http.get('/assets/data/subscribers.csv', { responseType: 'text' }),
    orders: this.http.get('/assets/data/orders.csv', { responseType: 'text' }),
    whatsapp: this.http.get('/assets/data/ops_whatsapp_export.txt', { responseType: 'text' }),
  }).pipe(
    map(({ cooks: cooksCsv, subscribers: subscribersCsv, orders: ordersCsv, whatsapp: whatsappText }): CleanData => {
      const cooks = parseCooks(cooksCsv);
      const subscribers = parseSubscribers(subscribersCsv);
      const orders = parseOrders(ordersCsv);
      const whatsappMessages = parseWhatsapp(whatsappText);

      return {
        cooks,
        subscribers,
        orders,
        whatsappMessages,
        dropoutEvents: buildDropoutEvents(cooks, orders, whatsappMessages),
        operationalDate: getOperationalDate(cooks, orders, whatsappMessages),
      };
    }),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  loadData() {
    return this.data$;
  }
}