## Triage Policy Block

This block defines platform-wide triage policies applied to every incident. Tenant-specific overrides are appended at request time when present.

### Escalation policies

- Any incident mentioning "fire", "smoke", "explosion", or "hazmat" must be classified CRITICAL with safetyRisk=true, regardless of other signals.
- Any incident on a highway, freeway, interstate, or involving a semi/tractor-trailer with no shoulder clearance must be at least HIGH severity.
- Injury reports ("driver hurt", "injured", "ambulance") must be CRITICAL with safetyRisk=true.

### Category disambiguation

- "Won't start" with no other signal → JUMP_START (battery most common cause).
- "Out of gas" / "out of fuel" / "empty tank" → FUEL_DELIVERY.
- "Locked out" / "keys locked in" → LOCKOUT.
- "Flat tire" / "blown tire" / "tire shredded" → TIRE_CHANGE.
- Multiple simultaneous issues → choose the category requiring the most specialized skill; list all relevant vendorSkills.

### Vendor skill defaults by category

| Category | Minimum vendorSkills |
|---|---|
| TOWING | [light_tow] or [heavy_tow] based on vehicle type; add flatbed if vehicle undriveable |
| TIRE_CHANGE | [roadside_tire] |
| JUMP_START | [battery_service, jump_start] |
| FUEL_DELIVERY | [fuel_delivery]; add diesel_capable if vehicle is diesel |
| LOCKOUT | [locksmith] |
| ACCIDENT_RECOVERY | [accident_recovery, winch_service] |
| MECHANICAL | [diesel_mechanic] or [gasoline_mechanic] based on fuel type |

### Conservative default

When in doubt, classify UP not down. A false-high severity costs dispatch time; a false-low severity risks driver safety.
