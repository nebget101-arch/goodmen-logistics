import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-settlement-detail',
  templateUrl: './settlement-detail.component.html',
  styleUrls: ['./settlement-detail.component.css']
})
export class SettlementDetailComponent implements OnInit {
  settlementId: string | null = null;
  loading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.settlementId = this.route.snapshot.paramMap.get('id');
  }

  backToList(): void {
    this.router.navigate(['/settlements']);
  }
}
