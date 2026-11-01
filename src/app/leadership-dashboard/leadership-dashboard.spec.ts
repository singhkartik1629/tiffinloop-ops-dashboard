import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CleanData, DataService } from '../data.service';
import { LeadershipDashboard } from './leadership-dashboard';

const source = {
  type: 'sheet' as const,
  sourceRow: 2,
  reporter: 'Cook status sheet',
  reportedAt: null,
  detail: 'Sheet status: on_leave',
};

describe('LeadershipDashboard', () => {
  const data: CleanData = {
    cooks: [],
    subscribers: [],
    orders: [],
    whatsappMessages: [],
    operationalDate: '2026-09-23',
    dropoutEvents: [
      {
        id: 'CK1:2026-09-23',
        cookId: 'CK1',
        cookName: 'Lakshmi Iyer',
        city: 'Bengaluru',
        date: '2026-09-23',
        meals: ['Lunch'],
        sources: [source],
      },
      {
        id: 'CK2:2026-09-10',
        cookId: 'CK2',
        cookName: 'Geeta Rao',
        city: 'Bengaluru',
        date: '2026-09-10',
        meals: ['Dinner'],
        sources: [{ ...source, sourceRow: 3 }],
      },
      {
        id: 'CK3:2026-08-20',
        cookId: 'CK3',
        cookName: 'Sunita Kulkarni',
        city: 'Mumbai',
        date: '2026-08-20',
        meals: ['Lunch'],
        sources: [{ ...source, sourceRow: 4 }],
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LeadershipDashboard],
      providers: [{ provide: DataService, useValue: { loadData: () => of(data) } }],
    }).compileComponents();
  });

  it('shows 30-day dropout frequency by city and cook using the seed date', () => {
    const fixture = TestBed.createComponent(LeadershipDashboard);
    fixture.detectChanges();

    const content = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(content).toContain('25 Aug 2026 – 23 Sept 2026');
    expect(content).toContain('Recorded dropouts2');
    expect(content).toContain('Bengaluru');
    expect(content).toContain('Lakshmi Iyer');
    expect(content).toContain('Geeta Rao');
    expect(content).not.toContain('Sunita Kulkarni');
  });
});