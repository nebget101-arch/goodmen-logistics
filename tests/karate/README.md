# FleetNeuron Karate API Tests

Maven multi-module Karate test suite for the FleetNeuron microservices. Each
microservice gets its own module so test ownership stays close to the service
and modules can be added additively without rework.

## Layout

```
tests/karate/
├── pom.xml              ← parent (shared deps, plugin versions, modules list)
├── karate-core/         ← shared config, hooks, helpers (test-jar)
│   ├── pom.xml
│   └── src/
│       ├── main/java/   ← java helpers (currently empty)
│       └── test/java/core/
│           ├── karate-config.js   ← env-aware base URL resolution
│           └── CoreRunner.java    ← placeholder runner
├── karate-gateway/      ← Phase 1: API gateway tests
│   ├── pom.xml          ← depends on karate-core test-jar
│   └── src/test/java/gateway/
│       ├── _smoke/
│       ├── _contract/
│       ├── routing/
│       ├── security/
│       ├── resiliency/
│       ├── negative/
│       └── GatewayParallelTest.java
└── (future: karate-auth-users/, karate-logistics/, karate-fleet/, ...)
```

`karate-core` is consumed by every other module via a Maven `test-jar`
classifier, so shared step definitions, fixtures, and `karate-config.js`
live in one place.

## Adding a new module

To cover a new microservice (example: `auth-users`):

1. Create the module directory under `tests/karate/`:
   ```
   tests/karate/karate-auth-users/
   ├── pom.xml
   └── src/test/java/authusers/
       └── AuthUsersParallelTest.java
   ```
2. Copy `karate-gateway/pom.xml` as a starting point and change:
   - `<artifactId>` to `karate-auth-users`
   - `<name>` to a human-readable description
   - any module-specific dependencies (otherwise inherit from parent)
   The `karate-core` test-jar dependency stays the same.
3. Add the module to the parent `pom.xml`:
   ```xml
   <modules>
       <module>karate-core</module>
       <module>karate-gateway</module>
       <module>karate-auth-users</module>   <!-- new -->
   </modules>
   ```
4. Place feature files under `src/test/java/authusers/` next to the runner so
   Karate's classpath conventions resolve them.
5. Run `mvn -pl karate-auth-users -am test-compile` to verify the module wires
   up correctly before adding tests.

No changes to existing modules are required — that's the point of the
additive layout.

## Running tests

All commands run from `tests/karate/`.

```bash
# compile only (fast structural sanity check)
mvn -pl karate-gateway -am test-compile

# run a single module
mvn -pl karate-gateway -am test

# run a single feature
mvn -pl karate-gateway -am test \
  -Dkarate.options="classpath:gateway/_smoke/health.feature"

# run by tag (e.g. only smoke tests)
mvn test -Dkarate.options="--tags @smoke"

# run everything
mvn test
```

`-am` ("also-make") tells Maven to build the module's dependencies (i.e.
`karate-core`) before the target module.

## Environment switching

The parent pom passes `karate.env` through to Surefire. `karate-config.js` in
`karate-core` reads it and selects the base URL set:

```bash
# default (local docker-compose)
mvn -pl karate-gateway -am test

# explicit local
mvn -pl karate-gateway -am test -Dkarate.env=local

# dev environment on Render
mvn -pl karate-gateway -am test -Dkarate.env=dev

# CI (used by GitHub Actions)
mvn -pl karate-gateway -am test -Dkarate.env=ci
```

If `karate.env` is unset, `karate-config.js` falls back to `local`.

## Reports

After a test run, each module writes its outputs under its own `target/`:

```
tests/karate/karate-gateway/target/
├── karate-reports/         ← Karate HTML + JSON summary (open index.html)
├── surefire-reports/       ← JUnit XML (consumed by CI)
└── allure-results/         ← Allure raw results (if @allure tags used)
```

To generate a combined Allure report locally:

```bash
allure serve karate-gateway/target/allure-results
```

CI uploads `karate-reports/` and `surefire-reports/` as workflow artifacts; see
`.github/workflows/` once the CI subtask lands.

## Conventions

- Feature files live next to the runner under `src/test/java/<module>/`.
- Tag smoke tests `@smoke`, contract checks `@contract`, negative paths
  `@negative` so subsets can be selected with `--tags`.
- Keep environment-specific values out of `.feature` files — read them from
  `karate-config.js` so the same feature runs against any env.
- Shared hooks, custom matchers, and helpers belong in `karate-core` so every
  module benefits.

## Requirements

- Java 17
- Maven 3.9+
- (Optional) [Allure CLI](https://allurereport.org/docs/install/) for local
  HTML report rendering.
