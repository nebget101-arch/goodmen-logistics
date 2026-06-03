package gateway;

import com.intuit.karate.Results;
import com.intuit.karate.Runner;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Placeholder parallel runner for the gateway test module.
 *
 * Discovers all *.feature files under src/test/java/gateway/ across the
 * _smoke, _contract, routing, security, resiliency, and negative folders.
 * No features exist yet — Karate returns 0 features and 0 failures, so the
 * assertion holds as a smoke check that the module wires up correctly.
 *
 * Tags, threads, and per-folder runners are introduced in later FN-893
 * stories (config, smoke, contract, etc.).
 */
class GatewayParallelTest {

    @Test
    void runAll() {
        Results results = Runner.path("classpath:gateway")
                .tags("~@ignore")
                .parallel(5);
        assertEquals(0, results.getFailCount(), results.getErrorMessages());
    }
}
