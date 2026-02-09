# K6 Performance Tests - Parameters Guide

All K6 tests are now parameterized using environment variables. You can customize test configurations by passing these variables when running tests.

## Running Tests Locally

```bash
# Smoke Test
VUS=5 DURATION=1m npm run test:smoke

# Load Test
RAMP_UP_TIME=5m STEADY_TIME=10m TARGET_VU_1=20 TARGET_VU_2=40 TARGET_VU_3=60 npm run test:load

# Stress Test
STRESS_RAMP_TIME=3m STRESS_STEADY_TIME=10m STRESS_TARGET_VU_1=30 STRESS_TARGET_VU_2=60 STRESS_TARGET_VU_3=120 STRESS_TARGET_VU_4=200 npm run test:stress

# Spike Test
SPIKE_NORMAL_VU=10 SPIKE_PEAK_VU=200 SPIKE_UP_TIME=1m SPIKE_SUSTAIN_TIME=5m npm run test:spike

# Soak Test
SOAK_VUS=50 SOAK_DURATION=2h npm run test:soak

# Vehicles Test
VEHICLES_RAMP_UP=1m VEHICLES_STEADY=5m VEHICLES_TARGET_VU=20 npm run test:vehicles
```

## GitHub Actions / Claude Desktop

When triggering tests via GitHub Actions or Claude Desktop, you can pass these parameters:

### GitHub Actions Manual Trigger

When manually triggering from GitHub UI:

1. Go to Actions → K6 Performance Tests → Run workflow
2. Select branch: **dev** (or main if merged)
3. Select test_type: `load`
4. In the config field, enter JSON with your parameters:

```json
{"RAMP_UP_TIME":"5m","STEADY_TIME":"10m","TARGET_VU_1":"20","TARGET_VU_2":"40","TARGET_VU_3":"60"}
```

**More examples:**

**Smoke test with 5 users for 2 minutes:**
```json
{"VUS":"5","DURATION":"2m"}
```

**Load test with custom configuration:**
```json
{"RAMP_UP_TIME":"3m","STEADY_TIME":"7m","TARGET_VU_1":"15","TARGET_VU_2":"30","TARGET_VU_3":"45"}
```

**Stress test with higher VUs:**
```json
{"STRESS_TARGET_VU_1":"30","STRESS_TARGET_VU_2":"70","STRESS_TARGET_VU_3":"140","STRESS_TARGET_VU_4":"220"}
```

**Spike test:**
```json
{"SPIKE_NORMAL_VU":"10","SPIKE_PEAK_VU":"200","SPIKE_SUSTAIN_TIME":"5m"}
```

**Soak test:**
```json
{"SOAK_VUS":"40","SOAK_DURATION":"30m"}
```

### Claude Desktop

When using Claude Desktop, just describe what you want naturally:
- "Run K6 smoke tests with 5 users for 2 minutes"
- "Run K6 load test with ramp up of 5m and steady time of 10m, target VUs 20, 40, 60"

Claude will automatically convert your request to the proper format.

---

### Available Parameters

### Smoke Test Parameters
- `smoke_vus`: Number of virtual users (default: 1)
- `smoke_duration`: Test duration (default: 30s)

**Example**: VUs=2, Duration=1m

### Load Test Parameters
- `load_ramp_up`: Ramp up time between levels (default: 2m)
- `load_steady`: Steady state time at each level (default: 5m)
- `load_target_vu1`: Target VU level 1 (default: 10)
- `load_target_vu2`: Target VU level 2 (default: 20)
- `load_target_vu3`: Target VU level 3 (default: 30)

**Example**: Ramp=3m, Steady=7m, Levels: 15→30→45

### Stress Test Parameters
- `stress_ramp_time`: Ramp time between levels (default: 2m)
- `stress_steady_time`: Steady time at each level (default: 5m)
- `stress_recovery_time`: Recovery time at end (default: 5m)
- `stress_target_vu1`: Normal load VUs (default: 20)
- `stress_target_vu2`: Above normal VUs (default: 50)
- `stress_target_vu3`: Stress level VUs (default: 100)
- `stress_target_vu4`: Breaking point VUs (default: 150)

**Example**: Ramp=3m, Steady=8m, Recovery=10m, Levels: 25→60→120→180

### Spike Test Parameters
- `spike_normal_vu`: Normal baseline VUs (default: 5)
- `spike_peak_vu`: Peak spike VUs (default: 100)
- `spike_up_time`: Time to reach peak (default: 30s)
- `spike_sustain_time`: How long to sustain peak (default: 3m)
- `spike_down_time`: Time to return to normal (default: 30s)
- `spike_recovery_time`: Recovery period (default: 2m)

**Example**: Normal=10, Peak=200, Up=1m, Sustain=5m

### Soak Test Parameters
- `soak_vus`: Number of virtual users (default: 20)
- `soak_duration`: Test duration (default: 1h)

**Example**: VUs=30, Duration=2h

### Vehicles Test Parameters
- `vehicles_ramp_up`: Ramp up time (default: 30s)
- `vehicles_steady`: Steady state time (default: 1m)
- `vehicles_ramp_down`: Ramp down time (default: 20s)
- `vehicles_target_vu`: Target VUs (default: 10)

**Example**: RampUp=1m, Steady=5m, RampDown=30s, VUs=25

## Environment Variable Names

| Test Type | Variable Prefix | Example |
|-----------|----------------|---------|
| Smoke | `VUS`, `DURATION` | `VUS=5` |
| Load | `RAMP_UP_TIME`, `STEADY_TIME`, `TARGET_VU_*` | `TARGET_VU_1=15` |
| Stress | `STRESS_*` | `STRESS_TARGET_VU_2=60` |
| Spike | `SPIKE_*` | `SPIKE_PEAK_VU=150` |
| Soak | `SOAK_*` | `SOAK_DURATION=2h` |
| Vehicles | `VEHICLES_*` | `VEHICLES_TARGET_VU=20` |

## K6 Duration Format

K6 accepts durations in these formats:
- `30s` = 30 seconds
- `1m` = 1 minute
- `5m` = 5 minutes
- `1h` = 1 hour
- `90m` = 90 minutes (1.5 hours)
- `2h30m` = 2 hours 30 minutes

## Tips

1. **Start small**: Use default values first, then gradually increase
2. **Monitor resources**: Higher VUs consume more memory and CPU
3. **Adjust thresholds**: If tests fail thresholds, consider if they're realistic
4. **Test environments**: Use smaller values in dev, realistic values in staging
5. **Cost awareness**: Longer tests (especially soak) consume more resources

## Example Claude Desktop Commands

```
"Run K6 smoke tests with 5 users for 2 minutes"
"Run K6 load test with ramp up of 5m and steady time of 10m"
"Run K6 stress test with target VUs of 30, 70, 140, 220"
"Run K6 spike test with normal load of 10 and peak of 200"
"Run K6 soak test with 40 users for 30 minutes"
```
