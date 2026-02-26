import { Component } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-user-create',
  templateUrl: './user-create.component.html',
  styleUrls: ['./user-create.component.css']
})
export class UserCreateComponent {
  firstName = '';
  lastName = '';
  email = '';
  username = '';
  password = '';
  role = 'admin';
  roles = ['admin', 'safety', 'fleet', 'dispatch'];
  message = '';
  error = '';

  constructor(private api: ApiService) {}

  get generatedUsername(): string {
    const first = this.firstName.trim().toLowerCase();
    const last = this.lastName.trim().toLowerCase();
    if (!first || !last) return '';
    return `${first}.${last}`;
  }

  createUser() {
    this.message = '';
    this.error = '';
    this.api.createUser({
      username: this.username,
      password: this.password,
      role: this.role,
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email
    })
      .subscribe({
        next: () => {
          this.message = 'User created successfully.';
          this.firstName = '';
          this.lastName = '';
          this.email = '';
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
