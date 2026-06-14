import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SignerPageComponent } from './signer-page/signer-page.component';

// FN-1798 — public signer routes. UNAUTHENTICATED: no AuthGuard/PlanGuard.
// The token in the URL is the only credential; the backend validates it.
const routes: Routes = [
  { path: ':token', component: SignerPageComponent },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PublicSignRoutingModule {}
