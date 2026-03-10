# Searchable Category Dropdown Feature

## Overview
The settlement detail page now includes a searchable dropdown for selecting expense/payment categories with the ability to create new categories on-the-fly.

## Features

### 🔍 Search & Filter
- Type to search categories by name or code
- Real-time filtering as you type
- Shows category code (#123) for easy identification
- Automatically filters by type (expense vs revenue) based on adjustment type

### ➕ Create New Categories
- If no matching category exists, a "Create new" option appears
- Click to open inline creation form
- New categories are immediately available after creation
- Auto-selects the newly created category

### 🎯 Smart Type Detection
- **Deductions/Advances/Corrections** → Shows expense categories
- **Earnings/Reimbursements** → Shows revenue categories
- Categories are automatically filtered based on adjustment type

### ✨ User Experience
- Clear button (×) to quickly reset selection
- Keyboard-friendly (focus/blur handling)
- Visual hierarchy (indented sub-categories)
- Smooth animations and hover states
- Loading states during category creation

## How to Use

### 1. Search for Existing Category
```
1. Click on the category search input
2. Type category name or code (e.g., "fuel" or "105")
3. Dropdown shows filtered results
4. Click on a category to select it
```

### 2. Create New Category
```
1. Type a new category name in the search box
2. If no exact match exists, "Create 'your-name'" option appears
3. Click the create option
4. Inline form opens with the name pre-filled
5. Click "Create" button
6. New category is created and auto-selected
```

### 3. Clear Selection
```
1. Click the (×) clear button next to the search input
2. Selection is removed and dropdown resets
```

## Technical Details

### Component State
```typescript
categorySearchQuery: string        // Current search text
filteredCategories: Category[]     // Filtered results
showCategoryDropdown: boolean      // Dropdown visibility
selectedCategoryName: string       // Currently selected category name
isCreatingCategory: boolean        // Creation form visibility
newCategoryName: string           // New category name being created
```

### Key Methods
- `onCategorySearchFocus()` - Opens dropdown
- `onCategorySearchInput()` - Filters categories
- `filterCategories()` - Performs search filtering
- `selectCategory(cat)` - Selects a category
- `clearCategorySelection()` - Clears selection
- `showCreateNewCategory()` - Determines if create option should show
- `startCreatingCategory()` - Opens creation form
- `createNewCategory()` - Submits new category to backend
- `cancelCreateCategory()` - Closes creation form

### Backend Integration
- Uses `ExpensePaymentCategoriesService`
- `createCategory()` API call returns new category with generated ID and code
- New categories start with code 2000+ (auto-generated)
- Categories are immediately available in dropdown after creation

## Styling

### AI-Console Theme
- Dark gradient background with blue border
- Hover states with subtle glow
- Category codes displayed as monospace badges
- Create option highlighted in green
- Clear button turns red on hover
- Smooth transitions and animations

### Responsive Design
- Dropdown height adjusts on mobile (200px vs 280px)
- Touch-friendly button sizes
- Proper z-index layering for overlay

## Data Flow

```
User types in search
    ↓
filterCategories() filters list
    ↓
Dropdown shows filtered results
    ↓
User clicks category OR "Create new"
    ↓
IF category: selectCategory(cat) → addAdjustment.category_id set
IF create: startCreatingCategory() → Form opens
    ↓
createNewCategory() → API call
    ↓
New category added to appropriate list (expense/revenue)
    ↓
Auto-select new category
    ↓
Success message shown
```

## Error Handling
- Backend validation errors shown in error message
- Failed creation doesn't close form (allows retry)
- Network errors handled gracefully
- Success messages auto-dismiss after 3 seconds

## Future Enhancements
- Keyboard navigation (arrow keys)
- Recent/favorite categories
- Category usage statistics in dropdown
- Bulk category import
- Category templates for common scenarios
