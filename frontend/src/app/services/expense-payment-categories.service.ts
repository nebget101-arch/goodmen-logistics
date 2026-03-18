import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface ExpensePaymentCategory {
  id: string;
  code: number;
  parent_code?: number;
  persistent: boolean;
  name: string;
  active: boolean;
  type: 'expense' | 'revenue';
  description?: string;
  notes?: string;
  value?: string;
  children?: ExpensePaymentCategory[];
  parent?: ExpensePaymentCategory;
  source?: 'global' | 'custom';
  created_at?: string;
  updated_at?: string;
}

export interface CategoryResponse {
  success: boolean;
  data: ExpensePaymentCategory | ExpensePaymentCategory[];
  total?: number;
  message?: string;
  error?: string;
}

export interface CategoryStats {
  id: string;
  code: number;
  name: string;
  type: 'expense' | 'revenue';
  active: boolean;
  settlement_usage: number;
  imported_usage: number;
  total_usage: number;
}

@Injectable({
  providedIn: 'root'
})
export class ExpensePaymentCategoriesService {
  private baseUrl = `${environment.apiUrl}/expense-categories`;

  constructor(private http: HttpClient) {}

  /**
   * Get all categories with optional filtering
   */
  getCategories(options?: {
    type?: 'expense' | 'revenue';
    active?: boolean;
    includeInactive?: boolean;
  }): Observable<ExpensePaymentCategory[]> {
    let params = new HttpParams();
    
    if (options?.type) {
      params = params.set('type', options.type);
    }
    if (options?.active !== undefined) {
      params = params.set('active', String(options.active));
    }
    if (options?.includeInactive) {
      params = params.set('includeInactive', 'true');
    }

    return this.http.get<CategoryResponse>(this.baseUrl, { params }).pipe(
      map(response => response.data as ExpensePaymentCategory[])
    );
  }

  /**
   * Get expense categories only
   */
  getExpenseCategories(includeInactive = false): Observable<ExpensePaymentCategory[]> {
    return this.getCategories({ type: 'expense', includeInactive });
  }

  /**
   * Get revenue categories only
   */
  getRevenueCategories(includeInactive = false): Observable<ExpensePaymentCategory[]> {
    return this.getCategories({ type: 'revenue', includeInactive });
  }

  /**
   * Get flat list of all active categories (no hierarchy)
   */
  getFlatCategories(type?: 'expense' | 'revenue'): Observable<ExpensePaymentCategory[]> {
    return this.getCategories({ type }).pipe(
      map(categories => this.flattenCategories(categories))
    );
  }

  /**
   * Helper to flatten hierarchical categories
   */
  private flattenCategories(categories: ExpensePaymentCategory[]): ExpensePaymentCategory[] {
    const result: ExpensePaymentCategory[] = [];
    
    const flatten = (cats: ExpensePaymentCategory[]) => {
      cats.forEach(cat => {
        result.push(cat);
        if (cat.children && cat.children.length > 0) {
          flatten(cat.children);
        }
      });
    };
    
    flatten(categories);
    return result;
  }

  /**
   * Get a single category by ID
   */
  getCategory(id: string): Observable<ExpensePaymentCategory> {
    return this.http.get<CategoryResponse>(`${this.baseUrl}/${id}`).pipe(
      map(response => response.data as ExpensePaymentCategory)
    );
  }

  /**
   * Create a new custom category
   */
  createCategory(category: {
    name: string;
    type: 'expense' | 'revenue';
    description?: string;
    notes?: string;
    parent_code?: number;
  }): Observable<ExpensePaymentCategory> {
    return this.http.post<CategoryResponse>(this.baseUrl, category).pipe(
      map(response => response.data as ExpensePaymentCategory)
    );
  }

  /**
   * Update an existing category
   */
  updateCategory(
    id: string,
    updates: {
      name?: string;
      active?: boolean;
      description?: string;
      notes?: string;
      parent_code?: number;
    }
  ): Observable<ExpensePaymentCategory> {
    return this.http.put<CategoryResponse>(`${this.baseUrl}/${id}`, updates).pipe(
      map(response => response.data as ExpensePaymentCategory)
    );
  }

  /**
   * Deactivate or delete a category
   */
  deleteCategory(id: string, hardDelete = false): Observable<{ success: boolean; message: string }> {
    const params = hardDelete ? new HttpParams().set('hardDelete', 'true') : new HttpParams();
    return this.http.delete<{ success: boolean; message: string }>(`${this.baseUrl}/${id}`, { params });
  }

  /**
   * Get usage statistics for all categories
   */
  getCategoryStats(): Observable<CategoryStats[]> {
    return this.http.get<{ success: boolean; data: CategoryStats[] }>(`${this.baseUrl}/stats/usage`).pipe(
      map(response => response.data)
    );
  }

  /**
   * Get categories formatted for dropdown/select
   */
  getCategoriesForDropdown(type?: 'expense' | 'revenue'): Observable<Array<{ value: string; label: string; code: number }>> {
    return this.getFlatCategories(type).pipe(
      map(categories =>
        categories
          .filter(cat => cat.active)
          .map(cat => ({
            value: cat.id,
            label: cat.parent_code ? `  ${cat.name}` : cat.name, // Indent sub-categories
            code: cat.code
          }))
      )
    );
  }
}
