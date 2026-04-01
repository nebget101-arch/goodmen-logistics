# SigNoz Self-Hosted — Render Deployment

FleetNeuron uses a self-hosted SigNoz stack for observability (distributed tracing, metrics, error tracking). This directory contains configuration files for the 3 Render services that make up the stack.

## Architecture

```
FleetNeuron Services (9)
        |
        | OTLP/HTTP (port 4318)
        v
+------------------+       +------------------+       +------------------+
| OTel Collector   | ----> | ClickHouse       | <---- | SigNoz Query +   |
| (Web Service)    |       | (Private Service) |       | Frontend (Web)   |
| Port: 4318       |       | Port: 9000        |       | Port: 3301       |
+------------------+       +------------------+       +------------------+
                            10GB persistent disk
```

## Render Services

| Service | Type | Docker Image | Plan | Cost |
|---------|------|-------------|------|------|
| signoz-clickhouse | Private | `clickhouse/clickhouse-server:24.1` | Starter+ (2GB, 10GB disk) | ~$25-35/mo |
| signoz-otel-collector | Web | `signoz/signoz-otel-collector:latest` | Starter (512MB) | ~$7/mo |
| signoz-dashboard | Web | `signoz/query-service:latest` | Starter (1GB) | ~$12/mo |
| **Total** | | | | **~$45-55/mo** |

## Configuration Files

- `otel-collector-config.yaml` — OpenTelemetry Collector pipeline config (receivers, processors, exporters)
- `clickhouse-config.xml` — ClickHouse server settings (memory limits, ports)
- `clickhouse-users.xml` — ClickHouse user authentication and quotas

## Environment Variables

### ClickHouse (signoz-clickhouse)
```
CLICKHOUSE_DB=signoz
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<set-in-render-dashboard>
```

### OTel Collector (signoz-otel-collector)
```
CLICKHOUSE_HOST=<signoz-clickhouse-private-url>
CLICKHOUSE_PORT=9000
CLICKHOUSE_DB=signoz
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<same-as-above>
```

### SigNoz Dashboard (signoz-dashboard)
```
CLICKHOUSE_HOST=<signoz-clickhouse-private-url>
CLICKHOUSE_PORT=9000
SIGNOZ_TELEMETRY_ENABLED=false
```

### FleetNeuron Services (all 9)
```
OTEL_EXPORTER_OTLP_ENDPOINT=https://signoz-otel-collector-fleetneuron.onrender.com
OTEL_SERVICE_NAME=fleetneuron-<service-name>
```

## Data Retention
- Traces: 15 days (auto-deleted via ClickHouse TTL)
- Metrics: 30 days
- Adjust via SigNoz Settings > Retention in the dashboard UI

## Local Development
Use `docker-compose.yml` which includes local SigNoz services. The OTel Collector is accessible at `http://signoz-otel-collector:4318` from within the Docker network.

## Deployment Steps

1. Deploy ClickHouse first (private service with persistent disk)
2. Deploy OTel Collector (needs ClickHouse host URL)
3. Deploy SigNoz Dashboard (needs ClickHouse host URL)
4. Set `CLICKHOUSE_PASSWORD` in Render dashboard (same value for all 3 services)
5. Access SigNoz at the dashboard URL and create admin account
6. Update FleetNeuron services with `OTEL_EXPORTER_OTLP_ENDPOINT`
