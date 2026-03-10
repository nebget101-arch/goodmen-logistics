# Searchable Category Dropdown - Visual Guide

## UI States

### State 1: Initial (Empty Search)
```
┌─────────────────────────────────────────────┐
│ Search or create category (optional)...   │
└─────────────────────────────────────────────┘
```

### State 2: Search Active (Typing "fuel")
```
┌─────────────────────────────────────────────┐
│ fuel                                    [×] │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ ⚡ Fuel                             #105   │ ← Hover: Blue highlight
├─────────────────────────────────────────────┤
│ ⚡ Fuel Tax                         #2010  │
└─────────────────────────────────────────────┘
```

### State 3: Category Selected
```
┌─────────────────────────────────────────────┐
│ Fuel                                    [×] │ ← Click × to clear
└─────────────────────────────────────────────┘
```

### State 4: No Match Found (Typing "new category")
```
┌─────────────────────────────────────────────┐
│ new category                            [×] │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ ➕ Create "new category"                    │ ← Green highlight
└─────────────────────────────────────────────┘
```

### State 5: Creating New Category
```
┌─────────────────────────────────────────────┐
│ Search or create category (optional)...   │ (Disabled)
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ 📁 Create New Category                      │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ new category                            │ │
│ └─────────────────────────────────────────┘ │
│ ┌──────────┐  ┌───────────────────────────┐│
│ │ Cancel   │  │ ✓ Create                  ││
│ └──────────┘  └───────────────────────────┘│
└─────────────────────────────────────────────┘
```

### State 6: Success (After Creating)
```
✓ Category "new category" created successfully

┌─────────────────────────────────────────────┐
│ new category                            [×] │ ← Auto-selected
└─────────────────────────────────────────────┘
```

## Complete Form Flow

```
┌──────────────────────────────────────────────────────────────┐
│ Manual adjustments                            $123.45        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌────────────────┐  Item Type                               │
│ │ [Deduction ▼] │  ← Determines category type              │
│ └────────────────┘                                          │
│                                                              │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ Description: Driver advance payment                 │     │
│ └─────────────────────────────────────────────────────┘     │
│                                                              │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ Amount: 500.00                                      │     │
│ └─────────────────────────────────────────────────────┘     │
│                                                              │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ advance payment                             [×]     │ ← Searchable
│ └─────────────────────────────────────────────────────┘     │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ 💰 Advance Pay                         #102        │     │
│ ├─────────────────────────────────────────────────────┤     │
│ │   Down payment                         #1003       │ ← Indented
│ └─────────────────────────────────────────────────────┘     │
│                                                              │
│ ┌──────────────────┐  Apply To                             │
│ │ [Primary payee ▼]│                                        │
│ └──────────────────┘                                        │
│                                                              │
│ ┌──────────────────────────────────┐                        │
│ │ ➕ Add adjustment                │                        │
│ └──────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

## Color Scheme

### Normal Dropdown Items
- Background: `rgba(17, 24, 39, 0.95)` (Dark blue-gray)
- Border: `rgba(59, 130, 246, 0.3)` (Blue)
- Text: `rgba(229, 231, 235, 0.95)` (Light gray)
- Code Badge: `rgba(55, 65, 81, 0.5)` (Gray badge)

### Hover State
- Background: `rgba(59, 130, 246, 0.15)` (Light blue overlay)

### Create New Option
- Background: `rgba(22, 101, 52, 0.1)` (Dark green)
- Text: `rgba(34, 197, 94, 0.95)` (Green)
- Hover: `rgba(22, 101, 52, 0.25)` (Brighter green)

### Clear Button
- Normal: `rgba(156, 163, 175, 0.8)` (Gray)
- Hover: `rgba(248, 113, 113, 1)` (Red)
- Background on hover: `rgba(239, 68, 68, 0.2)` (Light red)

## Keyboard Interaction (Current)
- **Click** search input → Opens dropdown
- **Type** → Filters results in real-time
- **Click** category → Selects and closes dropdown
- **Click** × button → Clears selection
- **Click** "Create new" → Opens creation form
- **Tab** → Moves to next field (dropdown closes)

## Mobile Responsive
- Dropdown max-height: 280px (desktop) → 200px (mobile)
- Touch-friendly tap targets (48px minimum)
- Reduced padding on small screens
