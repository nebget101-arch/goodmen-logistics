# PDF text extraction (pdftotext) in deployed environments

The load AI extractor uses a **multi-stage pipeline** to get text from rate confirmation PDFs:

1. **pdf-parse** (Node) – primary
2. **pdftotext -layout** (Poppler) – fallback when pdf-parse returns garbled text (e.g. embedded/CID fonts)
3. **OCR** – optional stub for future use

`pdftotext` is a **system binary** from [Poppler](https://poppler.freedesktop.org/). It is not an npm package.

## Where the extractor runs

- **Logistics service** (`backend/microservices/logistics-service`) loads goodmen-shared routes and runs the load extractor (single and bulk rate confirmation uploads).

## How to get pdftotext in each environment

### 1. Docker (local and Docker-based deploys)

The shared backend image already installs Poppler:

- **File:** `backend/Dockerfile.service`
- **Install:** `apk add --no-cache poppler-utils` (Alpine)

So any service built with that Dockerfile (e.g. `docker compose up` with the logistics-service) has `pdftotext` available. No extra steps.

### 2. Render (and similar PaaS with Node runtime)

On Render, services using **`runtime: node`** run in a managed Node environment. You **cannot** install system packages like Poppler there.

**Options:**

- **Keep Node runtime**  
  The extractor still works: it uses **pdf-parse** only. If a PDF decodes as garbled, the API returns a clear warning and does not call OpenAI. For many PDFs this is enough.

- **Use Docker for the logistics service** (recommended if you see garbled extraction often)  
  Render supports **Docker** as a runtime. To get `pdftotext`:

  1. In the Render dashboard, create (or edit) the **logistics** web service.
  2. Set **Environment** to **Docker**.
  3. Set **Dockerfile Path** to `backend/Dockerfile.service` (or a Dockerfile that extends it and sets `SERVICE_DIR=backend/microservices/logistics-service`).
  4. Set **Docker Context** to the repo root so the Dockerfile can `COPY backend ./backend` and run `npm install` in the service dir.
  5. Build args: `SERVICE_DIR=backend/microservices/logistics-service`.

  The same `Dockerfile.service` already installs `poppler-utils`, so the container will have `pdftotext`.

### 3. Other Linux servers (VPS, EC2, etc.)

Install Poppler using the system package manager:

- **Debian/Ubuntu:** `sudo apt-get update && sudo apt-get install -y poppler-utils`
- **RHEL/CentOS:** `sudo yum install -y poppler-utils` (or `dnf` where applicable)
- **Alpine:** `apk add --no-cache poppler-utils` (same as in the Dockerfile)

### 4. macOS (local dev)

- **Homebrew:** `brew install poppler`

---

**Summary:** For **Docker** (including Render with Docker), pdftotext is already included. For **Render with Node**, either accept pdf-parse-only behavior or run the logistics service as a Docker service to get pdftotext.
