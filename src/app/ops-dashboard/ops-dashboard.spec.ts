import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CleanData, DataService } from '../data.service';
import { buildDropoutEvents } from '../operations';
import { OpsDashboard } from './ops-dashboard';

const eventDate = '2026-09-23';

describe('OpsDashboard', () => {
  let testData: CleanData;

  const createData = (backupCapacity: number, secondDiet = 'Veg'): CleanData => {
    const cooks: CleanData['cooks'] = [
      {
        sourceRow: 2,
        raw: { status: 'on_leave' },
        id: 'CK001',
        name: 'Neha Agarwal',
        city: 'Bengaluru',
        cuisine: 'Maharashtrian',
        serves: ['Veg', 'Jain'],
        phone: null,
        status: 'on_leave',
        statusSince: eventDate,
        joinedDate: null,
        maxDailyOrders: 30,
      },
      {
        sourceRow: 3,
        raw: { status: 'active' },
        id: 'CK002',
        name: 'Meera Iyer',
        city: 'Bengaluru',
        cuisine: 'South Indian',
        serves: ['Veg'],
        phone: null,
        status: 'active',
        statusSince: null,
        joinedDate: null,
        maxDailyOrders: backupCapacity,
      },
      {
        sourceRow: 4,
        raw: { status: 'active' },
        id: 'CK003',
        name: 'Kiran Shah',
        city: 'Mumbai',
        cuisine: 'Gujarati',
        serves: ['Veg', 'Jain'],
        phone: null,
        status: 'active',
        statusSince: null,
        joinedDate: null,
        maxDailyOrders: 20,
      },
    ];
    const subscribers: CleanData['subscribers'] = [
      {
        sourceRow: 2,
        raw: {},
        id: 'SUB001',
        name: 'Asha Rao',
        city: 'Bengaluru',
        phone: null,
        cookId: 'CK001',
        mealPlan: 'Lunch Only',
        cuisinePreference: 'Maharashtrian',
        diet: 'Veg',
        status: 'active',
        startDate: null,
      },
      {
        sourceRow: 3,
        raw: {},
        id: 'SUB002',
        name: 'Zoya Rao',
        city: 'Bengaluru',
        phone: null,
        cookId: 'CK001',
        mealPlan: 'Lunch Only',
        cuisinePreference: 'Maharashtrian',
        diet: secondDiet,
        status: 'active',
        startDate: null,
      },
    ];
    const orders: CleanData['orders'] = [
      {
        sourceRow: 2,
        raw: { status: 'pending' },
        id: 'ORD001',
        date: eventDate,
        subscriberId: 'SUB001',
        cookId: 'CK001',
        mealType: 'Lunch',
        status: 'pending',
        amount: 159,
      },
      {
        sourceRow: 3,
        raw: { status: 'pending' },
        id: 'ORD002',
        date: eventDate,
        subscriberId: 'SUB002',
        cookId: 'CK001',
        mealType: 'Lunch',
        status: 'pending',
        amount: 159,
      },
      {
        sourceRow: 4,
        raw: { status: 'pending' },
        id: 'ORD003',
        date: eventDate,
        subscriberId: 'SUB999',
        cookId: 'CK002',
        mealType: 'Lunch',
        status: 'pending',
        amount: 159,
      },
    ];
    const whatsappMessages: CleanData['whatsappMessages'] = [];

    return {
      cooks,
      subscribers,
      orders,
      whatsappMessages,
      dropoutEvents: buildDropoutEvents(cooks, orders, whatsappMessages),
      operationalDate: eventDate,
    };
  };

  beforeEach(async () => {
    localStorage.clear();
    testData = createData(3);
    await TestBed.configureTestingModule({
      imports: [OpsDashboard],
      providers: [
        { provide: DataService, useValue: { loadData: () => of(testData) } },
      ],
    }).compileComponents();
  });

  function showEvent(): ComponentFixture<OpsDashboard> {
    const fixture = TestBed.createComponent(OpsDashboard);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = eventDate;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return fixture;
  }

  it('shows only affected orders and assigns within remaining capacity', () => {
    const content = (showEvent().nativeElement as HTMLElement).textContent ?? '';
    expect(content).toContain('ORD001');
    expect(content).toContain('ORD002');
    expect(content).not.toContain('ORD003');
    expect(content).toContain('Reassign to Meera Iyer');
    expect(content).toContain('2 orders');
  });

  it('does not assign a cook who cannot serve the subscriber diet', () => {
    testData = createData(3, 'Jain');
    const content = (showEvent().nativeElement as HTMLElement).textContent ?? '';
    expect(content).toContain('No active, diet-compatible same-city cook');
    expect(content).toContain('Asha Rao');
    expect(content).toContain('Zoya Rao');
  });

  it('does not exceed remaining per-meal capacity', () => {
    testData = createData(2);
    const content = (showEvent().nativeElement as HTMLElement).textContent ?? '';
    expect(content).toContain('Reassign to Meera Iyer');
    expect(content).toContain('No active, diet-compatible same-city cook');
  });

  it('records decisions and displays simulated notification status', () => {
    const fixture = showEvent();
    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const content = element.textContent ?? '';
    expect(content).toContain('Simulated SMS messages');
    expect(content).toContain('Resolution traceability');
    expect(content).toContain('Subscriber notifications');
    const messageRows = element.querySelectorAll('section[aria-live="polite"] li');
    expect(messageRows).toHaveLength(2);
    expect([...messageRows].every((row) => row.textContent?.includes('Sent'))).toBe(true);
    expect(JSON.parse(localStorage.getItem('tiffinloop.traceability.v1') ?? '[]')).toHaveLength(1);
  });
});