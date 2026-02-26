import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  username = '';
  password = '';
  error = '';

  constructor(private api: ApiService, private router: Router) {}

  login() {
    this.api.login(this.username, this.password).subscribe({
      next: (res) => {
        localStorage.setItem('token', res.token);
        localStorage.setItem('role', res.role);
        if (res.username) {
          localStorage.setItem('username', res.username);
        }
        if (res.firstName || res.lastName) {
          const displayName = `${res.firstName || ''}${res.firstName && res.lastName ? '.' : ''}${res.lastName || ''}`.trim().toLowerCase();
          if (displayName) {
            localStorage.setItem('displayName', displayName);
          }
        }
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.error = 'Invalid username or password';
      }
    });
  }
}
