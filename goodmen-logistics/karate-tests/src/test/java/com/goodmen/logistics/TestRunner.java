package com.goodmen.logistics;

import com.intuit.karate.junit5.Karate;

/**
 * Main Test Runner for all Karate API tests
 * Executes all feature files in parallel
 */
public class TestRunner {

    @Karate.Test
    Karate testAll() {
        return Karate.run().relativeTo(getClass());
    }

    @Karate.Test
    Karate testParallel() {
        return Karate.run().tags("~@ignore").relativeTo(getClass()).parallel(5);
    }

    @Karate.Test
    Karate testSmoke() {
        return Karate.run().tags("@smoke").relativeTo(getClass());
    }

    @Karate.Test
    Karate testRegression() {
        return Karate.run().tags("@regression").relativeTo(getClass()).parallel(5);
    }
}
