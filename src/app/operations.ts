import { Cook, Order, Subscriber, WhatsappMessage } from './parser';

export type EventSourceType = 'sheet' | 'whatsapp' | 'order';

export interface EventSource {
  type: EventSourceType;
  sourceRow: number;
  reporter: string;
  reportedAt: string | null;
  detail: string;
}

export interface DropoutEvent {
  id: string;
  cookId: string;
  cookName: string;
  city: string | null;
  date: string;
  meals: string[];
  sources: EventSource[];
}

export type ResolutionOutcome =
  | 'reassigned'
  | 'refund'
  | 'needs_ops'
  | 'already_resolved';

export interface OrderResolution {
  order: Order;
  subscriber: Subscriber | null;
  event: DropoutEvent;
  outcome: ResolutionOutcome;
  backupCook: Cook | null;
  reason: string;
  headroom: number | null;
}

const LIVE_ORDER_STATUSES = new Set(['pending', 'in_progress']);
const UNRESOLVED_ORDER_STATUSES = new Set([
  'pending',
  'in_progress',
  'cook_failure',
  'ambiguous',
  'cancelled',
  'refunded',
]);

export function getOperationalDate(
  cooks: Cook[],
  orders: Order[],
  messages: WhatsappMessage[],
): string | null {
  const dates = [
    ...cooks.map((cook) => cook.statusSince),
    ...orders.map((order) => order.date),
    ...messages.map((message) => ('date' in message ? message.date : null)),
  ].filter((date): date is string => Boolean(date));

  return dates.sort().at(-1) ?? null;
}

export function buildDropoutEvents(
  cooks: Cook[],
  orders: Order[],
  messages: WhatsappMessage[],
): DropoutEvent[] {
  const cookById = new Map(
    cooks.filter((cook) => cook.id).map((cook) => [cook.id!, cook]),
  );
  const events = new Map<string, DropoutEvent>();

  const addEvent = (
    cook: Cook,
    date: string,
    source: EventSource,
    meal?: string | null,
  ) => {
    if (!cook.id) return;
    const id = `${cook.id}:${date}`;
    let event = events.get(id);
    if (!event) {
      event = {
        id,
        cookId: cook.id,
        cookName: cook.name ?? cook.id,
        city: cook.city,
        date,
        meals: [],
        sources: [],
      };
      events.set(id, event);
    }
    if (!event.sources.some((existing) => existing.type === source.type && existing.sourceRow === source.sourceRow)) {
      event.sources.push(source);
    }
    if (meal && !event.meals.includes(meal)) event.meals.push(meal);
  };

  for (const cook of cooks) {
    if (cook.status === 'on_leave' && cook.statusSince) {
      addEvent(cook, cook.statusSince, {
        type: 'sheet',
        sourceRow: cook.sourceRow,
        reporter: 'Cook status sheet',
        reportedAt: null,
        detail: `Sheet status: ${cook.raw['status'] ?? cook.status}`,
      });
    }
  }

  for (const order of orders) {
    if (order.status !== 'cook_failure' || !order.cookId || !order.date) continue;
    const cook = cookById.get(order.cookId);
    if (!cook) continue;
    addEvent(cook, order.date, {
      type: 'order',
      sourceRow: order.sourceRow,
      reporter: 'Order status',
      reportedAt: null,
      detail: `Order ${order.id ?? order.sourceRow} status: ${order.raw['status'] ?? order.status}`,
    }, order.mealType);
  }

  for (const message of messages) {
    if (!('classification' in message) || message.classification !== 'dropout') continue;
    const cook = findMentionedCook(message.message, cooks) ?? findMentionedCook(message.sender, cooks);
    if (!cook || !message.date) continue;
    addEvent(cook, message.date, {
      type: 'whatsapp',
      sourceRow: message.sourceLine,
      reporter: message.sender,
      reportedAt: `${message.date} ${message.time}`,
      detail: message.message,
    });
  }

  for (const event of events.values()) {
    for (const order of orders) {
      if (
        order.cookId === event.cookId &&
        order.date === event.date &&
        order.mealType &&
        UNRESOLVED_ORDER_STATUSES.has(order.status ?? '') &&
        !event.meals.includes(order.mealType)
      ) {
        event.meals.push(order.mealType);
      }
    }
    if (!event.meals.length) event.meals = ['All meals'];
    event.meals.sort((a, b) => mealDeadline(a) - mealDeadline(b));
    event.sources.sort((a, b) => a.sourceRow - b.sourceRow);
  }

  return [...events.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.cookName.localeCompare(b.cookName),
  );
}

export function resolveOrdersForDate(
  date: string,
  events: DropoutEvent[],
  cooks: Cook[],
  subscribers: Subscriber[],
  orders: Order[],
  currentTime = '10:30',
): OrderResolution[] {
  const eventByCookId = new Map(
    events.filter((event) => event.date === date).map((event) => [event.cookId, event]),
  );
  const droppedCookIds = new Set(eventByCookId.keys());
  const subscriberById = new Map(
    subscribers.filter((subscriber) => subscriber.id).map((subscriber) => [subscriber.id!, subscriber]),
  );
  const currentMinutes = timeToMinutes(currentTime);
  const affected = orders
    .filter(
      (order) =>
        order.date === date &&
        Boolean(order.cookId && eventByCookId.has(order.cookId)) &&
        UNRESOLVED_ORDER_STATUSES.has(order.status ?? ''),
    )
    .sort((a, b) => mealDeadline(a.mealType) - mealDeadline(b.mealType) || (a.id ?? '').localeCompare(b.id ?? ''));
  const projectedLoads = new Map<string, number>();
  const getLoadKey = (cookId: string, mealType: string) => `${cookId}:${date}:${normalizeMeal(mealType)}`;

  for (const cook of cooks) {
    if (!cook.id) continue;
    for (const order of orders) {
      if (
        order.cookId === cook.id &&
        order.date === date &&
        order.mealType &&
        LIVE_ORDER_STATUSES.has(order.status ?? '')
      ) {
        const key = getLoadKey(cook.id, order.mealType);
        projectedLoads.set(key, (projectedLoads.get(key) ?? 0) + 1);
      }
    }
  }

  const resolutions: OrderResolution[] = [];
  for (const order of affected) {
    const event = eventByCookId.get(order.cookId!)!;
    const subscriber = subscriberById.get(order.subscriberId ?? '') ?? null;
    if (order.status === 'cancelled' || order.status === 'refunded') {
      resolutions.push({ order, subscriber, event, outcome: 'already_resolved', backupCook: null, reason: `Order is already ${order.status}`, headroom: null });
      continue;
    }
    if (order.status === 'ambiguous') {
      resolutions.push({ order, subscriber, event, outcome: 'needs_ops', backupCook: null, reason: 'Order status is ambiguous; confirm responsibility before reassigning', headroom: null });
      continue;
    }
    if (!subscriber || !order.mealType) {
      resolutions.push({ order, subscriber, event, outcome: 'needs_ops', backupCook: null, reason: !subscriber ? 'Subscriber ID could not be matched' : 'Meal type is missing', headroom: null });
      continue;
    }

    const cutoff = mealDeadline(order.mealType);
    if (cutoff === Number.POSITIVE_INFINITY) {
      resolutions.push({ order, subscriber, event, outcome: 'needs_ops', backupCook: null, reason: 'Meal window is unknown', headroom: null });
      continue;
    }
    if (currentMinutes >= cutoff) {
      resolutions.push({ order, subscriber, event, outcome: 'refund', backupCook: null, reason: `Late: ${order.mealType} window has opened; re-cooking skipped`, headroom: null });
      continue;
    }

    const candidates = cooks
      .filter((cook) =>
        cook.id !== null &&
        !droppedCookIds.has(cook.id) &&
        cook.status === 'active' &&
        cook.city === subscriber.city &&
        cook.maxDailyOrders !== null &&
        servesDiet(cook, subscriber.diet),
      )
      .map((cook) => {
        const load = projectedLoads.get(getLoadKey(cook.id!, order.mealType!)) ?? 0;
        return { cook, load, headroom: cook.maxDailyOrders! - load };
      })
      .filter(({ headroom }) => headroom > 0)
      .sort((a, b) =>
        Number(cuisineMatches(b.cook, subscriber)) - Number(cuisineMatches(a.cook, subscriber)) ||
        b.headroom - a.headroom ||
        a.load - b.load ||
        (a.cook.name ?? '').localeCompare(b.cook.name ?? ''),
      );
    const match = candidates[0];

    if (!match) {
      resolutions.push({ order, subscriber, event, outcome: 'refund', backupCook: null, reason: 'No active, diet-compatible same-city cook has headroom for this meal', headroom: null });
      continue;
    }

    const key = getLoadKey(match.cook.id!, order.mealType);
    projectedLoads.set(key, (projectedLoads.get(key) ?? 0) + 1);
    const reason = `${cuisineMatches(match.cook, subscriber) ? 'Cuisine match; ' : ''}${match.headroom} slot(s) available before assignment`;
    resolutions.push({ order, subscriber, event, outcome: 'reassigned', backupCook: match.cook, reason, headroom: match.headroom });
  }

  return resolutions;
}

export function findMentionedCook(message: string, cooks: Cook[]): Cook | null {
  const text = message.toLowerCase();
  const exactMatches = cooks.filter((cook) => cook.name && text.includes(cook.name.toLowerCase()));
  if (exactMatches.length === 1) return exactMatches[0]!;
  if (exactMatches.length > 1) return null;

  const firstNameMatches = cooks.filter((cook) => {
    const firstName = cook.name?.split(/\s+/)[0];
    return firstName && text.includes(firstName.toLowerCase());
  });
  return firstNameMatches.length === 1 ? firstNameMatches[0]! : null;
}

function servesDiet(cook: Cook, diet: string | null): boolean {
  if (!diet) return false;
  const required = diet.toLowerCase().replace(/\s+/g, '-');
  return cook.serves.some((option) => option.toLowerCase().replace(/\s+/g, '-') === required);
}

function cuisineMatches(cook: Cook, subscriber: Subscriber): boolean {
  return Boolean(
    cook.cuisine &&
      subscriber.cuisinePreference &&
      cook.cuisine.toLowerCase() === subscriber.cuisinePreference.toLowerCase(),
  );
}

function normalizeMeal(meal: string): string {
  return meal.trim().toLowerCase();
}

function mealDeadline(meal: string | null): number {
  const normalized = meal?.trim().toLowerCase();
  if (normalized === 'lunch') return 12 * 60 + 30;
  if (normalized === 'dinner') return 19 * 60 + 30;
  return Number.POSITIVE_INFINITY;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}