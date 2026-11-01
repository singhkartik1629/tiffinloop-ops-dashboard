import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import {
  Cook,
  Order,
  Subscriber,
  parseCooks,
  parseDate,
  parseOrders,
  parseSubscribers,
  parseWhatsapp,
} from './parser';
import {
  buildDropoutEvents,
  findMentionedCook,
  getOperationalDate,
  resolveOrdersForDate,
} from './operations';

const dataDirectory = join(cwd(), 'src', 'assets', 'data');

describe('dropout event and order resolution', () => {
  it('parses ISO, day-first, and month-name dates', () => {
    expect(parseDate('2026-09-23')).toBe('2026-09-23');
    expect(parseDate('23/09/2026')).toBe('2026-09-23');
    expect(parseDate('19-Sep-2026')).toBe('2026-09-19');
    expect(parseDate('31/02/2026')).toBeNull();
  });

  it('merges sheet and WhatsApp reports and resolves the seed 24-order scenario', () => {
    const cooks = parseCooks(readFileSync(join(dataDirectory, 'cooks.csv'), 'utf8'));
    const subscribers = parseSubscribers(readFileSync(join(dataDirectory, 'subscribers.csv'), 'utf8'));
    const orders = parseOrders(readFileSync(join(dataDirectory, 'orders.csv'), 'utf8'));
    const messages = parseWhatsapp(readFileSync(join(dataDirectory, 'ops_whatsapp_export.txt'), 'utf8'));
    const events = buildDropoutEvents(cooks, orders, messages);

    expect(getOperationalDate(cooks, orders, messages)).toBe('2026-09-23');
    expect(messages.find((message) => 'message' in message && message.message.includes('on track')))
      .toMatchObject({ classification: 'not_dropout' });
    expect(messages.find((message) => 'message' in message && message.message.includes('30 min late')))
      .toMatchObject({ classification: 'not_dropout' });
    expect(messages.find((message) => 'message' in message && message.message.includes('Lakshmi')))
      .toMatchObject({ classification: 'dropout', date: '2026-09-23' });
    expect(messages.find((message) => 'message' in message && message.message.includes('Lakshmi')))
      .toMatchObject({ sender: 'Priya (Ops)' });
    const lakshmiMessage = messages.find((message) => 'message' in message && message.message.includes('Lakshmi'));
    expect(lakshmiMessage && 'message' in lakshmiMessage
      ? findMentionedCook(lakshmiMessage.message, cooks)?.id
      : null).toBe('CK086');

    const eventDay = events.filter((event) => event.date === '2026-09-23');
    expect(eventDay.map((event) => event.cookId).sort()).toEqual(['CK086', 'CK087', 'CK090']);
    expect(eventDay.find((event) => event.cookId === 'CK086')?.sources.map((source) => source.type).sort())
      .toEqual(['sheet', 'whatsapp']);
    expect(eventDay.find((event) => event.cookId === 'CK090')?.sources.map((source) => source.type))
      .toEqual(['whatsapp']);

    const resolutions = resolveOrdersForDate(
      '2026-09-23',
      events,
      cooks,
      subscribers,
      orders,
      '10:30',
    );
    expect(resolutions).toHaveLength(24);
    expect(new Set(resolutions.map((resolution) => resolution.order.id)).size).toBe(24);
    expect(resolutions.every((resolution) => resolution.outcome === 'reassigned')).toBe(true);
    expect(resolutions.every((resolution) => resolution.order.sourceRow > 1)).toBe(true);
  });

  it('does not count ambiguous no-show order statuses as cook failures', () => {
    const orders = parseOrders(
      'order_id,order_date,subscriber_id,cook_id,meal_type,status,amount_inr\n' +
      'ORD1,23/09/2026,SUB1,CK1,Lunch,no show,100\n' +
      'ORD2,2026-09-23,SUB2,CK1,Dinner,cook_no_show,100',
    );
    expect(orders.map((order) => order.status)).toEqual(['ambiguous', 'cook_failure']);
  });

  it('refunds orders after a meal cutoff and holds ambiguous orders for ops review', () => {
    const cooks: Cook[] = [
      {
        sourceRow: 2,
        raw: { status: 'on_leave' },
        id: 'CK1',
        name: 'Unavailable Cook',
        city: 'Bengaluru',
        cuisine: 'South Indian',
        serves: ['Veg'],
        phone: null,
        status: 'on_leave',
        statusSince: '2026-09-23',
        joinedDate: null,
        maxDailyOrders: 20,
      },
      {
        sourceRow: 3,
        raw: { status: 'active' },
        id: 'CK2',
        name: 'Backup Cook',
        city: 'Bengaluru',
        cuisine: 'South Indian',
        serves: ['Veg'],
        phone: null,
        status: 'active',
        statusSince: null,
        joinedDate: null,
        maxDailyOrders: 20,
      },
    ];
    const subscribers: Subscriber[] = [
      {
        sourceRow: 2,
        raw: {},
        id: 'SUB1',
        name: 'Lunch Subscriber',
        city: 'Bengaluru',
        phone: null,
        cookId: 'CK1',
        mealPlan: 'Lunch Only',
        cuisinePreference: 'South Indian',
        diet: 'Veg',
        status: 'active',
        startDate: null,
      },
      {
        sourceRow: 3,
        raw: {},
        id: 'SUB2',
        name: 'Ambiguous Subscriber',
        city: 'Bengaluru',
        phone: null,
        cookId: 'CK1',
        mealPlan: 'Dinner Only',
        cuisinePreference: 'South Indian',
        diet: 'Veg',
        status: 'active',
        startDate: null,
      },
    ];
    const orders: Order[] = [
      {
        sourceRow: 2,
        raw: { status: 'pending' },
        id: 'ORD1',
        date: '2026-09-23',
        subscriberId: 'SUB1',
        cookId: 'CK1',
        mealType: 'Lunch',
        status: 'pending',
        amount: 100,
      },
      {
        sourceRow: 3,
        raw: { status: 'no show' },
        id: 'ORD2',
        date: '2026-09-23',
        subscriberId: 'SUB2',
        cookId: 'CK1',
        mealType: 'Dinner',
        status: 'ambiguous',
        amount: 100,
      },
    ];
    const events = buildDropoutEvents(cooks, orders, []);
    const resolutions = resolveOrdersForDate(
      '2026-09-23',
      events,
      cooks,
      subscribers,
      orders,
      '12:30',
    );

    expect(resolutions.map((resolution) => resolution.outcome)).toEqual(['refund', 'needs_ops']);
    expect(resolutions[0]?.reason).toContain('window has opened');
    expect(resolutions[1]?.reason).toContain('ambiguous');
  });
});