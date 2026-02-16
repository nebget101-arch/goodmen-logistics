import { Component } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-user-create',
  templateUrl: './user-create.component.html',
  styleUrls: ['./user-create.component.css']
})
export class UserCreateComponent {
  username = '';
  password = '';
  role = 'admin';
  roles = ['admin', 'safety', 'fleet', 'dispatch'];
  message = '';
  error = '';

  constructor(private api: ApiService) {}

  createUser() {
    this.message = '';
    this.error = '';
    this.api.createUser({ username: this.username, password: this.password, role: this.role })
      .subscribe({
        next: () => {
          this.message = 'User created successfully.';
          this.username = '';
          this.password = '';
          this.role = 'admin';
        },
        error: err => {
          this.error = err.error?.error || 'Failed to create user.';
        }
      });
  }
}
