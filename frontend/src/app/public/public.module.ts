import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PublicRoutingModule } from './public-routing.module';
import { PublicHomeComponent } from './components/public-home/public-home.component';
import { PublicTrialComponent } from './components/public-trial/public-trial.component';
import { PublicTrialSignupComponent } from './components/public-trial-signup/public-trial-signup.component';

@NgModule({
  declarations: [
    PublicHomeComponent,
    PublicTrialComponent,
    PublicTrialSignupComponent
  ],
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    PublicRoutingModule
  ]
})
export class PublicModule {}
