import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PublicHomeComponent } from './components/public-home/public-home.component';
import { PublicTrialComponent } from './components/public-trial/public-trial.component';

const routes: Routes = [
  {
    path: '',
    component: PublicHomeComponent,
    pathMatch: 'full'
  },
  {
    path: 'trial',
    component: PublicTrialComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PublicRoutingModule {}
