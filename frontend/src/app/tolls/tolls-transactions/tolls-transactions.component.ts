import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ManualTollDialogComponent } from './manual-toll-dialog/manual-toll-dialog.component';

@Component({
  selector: 'app-tolls-transactions',
  templateUrl: './tolls-transactions.component.html',
  styleUrls: ['./tolls-transactions.component.css']
})
export class TollsTransactionsComponent {
  successMsg = '';

  constructor(private dialog: MatDialog) {}

  openAddTollDialog(): void {
    const dialogRef = this.dialog.open(ManualTollDialogComponent, {
      width: '600px',
      maxWidth: '96vw',
      disableClose: false,
      panelClass: 'dark-dialog'
    });

    dialogRef.afterClosed().subscribe((result: { saved: boolean } | undefined) => {
      if (result?.saved) {
        this.successMsg = 'Toll transaction added successfully.';
        setTimeout(() => { this.successMsg = ''; }, 4000);
        // Future: refresh transactions grid here
      }
    });
  }
}
