import { Routes } from '@angular/router';
import { OpsDashboard } from './ops-dashboard/ops-dashboard';
import { LeadershipDashboard } from './leadership-dashboard/leadership-dashboard';

export const routes: Routes = [
	{ path: '', component: OpsDashboard },
	{ path: 'leadership', component: LeadershipDashboard },
	{ path: '**', redirectTo: '' },
];
