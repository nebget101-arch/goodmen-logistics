import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';

const routes: Routes = [
  { path: '', component: ReportsPageComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/reports' } }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ReportsRoutingModule {}
