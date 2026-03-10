#!/usr/bin/env python3
import re

with open('dispatch-drivers.component.ts', 'r') as f:
    content = f.read()

# Remove the conditional dropdown hide code
old_hide = """        // Hide the dropdown
        if (type === 'primary') {
          this.showPrimaryPayeeDropdown = false;
        } else {
          this.showAdditionalPayeeDropdown = false;
        }"""
new_hide = """        this.showAdditionalPayeeDropdown = false;"""
content = content.replace(old_hide, new_hide)

# Update the createEquipmentOwner auto-select logic  
old_select = """            if (this.isCreatingEquipmentOwner === 'primary') {
              this.filteredPrimaryPayees.push(newPayee);
              this.selectPrimaryPayee(newPayee);
            } else {
              this.filteredAdditionalPayees.push(newPayee);
              this.selectAdditionalPayee(newPayee);
            }"""
new_select = """            this.filteredAdditionalPayees.push(newPayee);
            this.selectAdditionalPayee(newPayee);"""
content = content.replace(old_select, new_select)

# Update primary payee blur to not check for equipment owner creation
old_primary_blur = """          // Only hide dropdown if we're not about to create a new equipment owner
          if (this.isCreatingEquipmentOwner !== 'primary') {
            this.showPrimaryPayeeDropdown = false;
          }"""
new_primary_blur = """          this.showPrimaryPayeeDropdown = false;"""
content = content.replace(old_primary_blur, new_primary_blur)

# Update additional payee blur condition
old_additional_blur = """          // Only hide dropdown if we're not about to create a new equipment owner
          if (this.isCreatingEquipmentOwner !== 'additional') {
            this.showAdditionalPayeeDropdown = false;
          }"""
new_additional_blur = """          if (!this.isCreatingEquipmentOwner) {
            this.showAdditionalPayeeDropdown = false;
          }"""
content = content.replace(old_additional_blur, new_additional_blur)

with open('dispatch-drivers.component.ts', 'w') as f:
    f.write(content)

print("✓ Updated TypeScript component successfully")
