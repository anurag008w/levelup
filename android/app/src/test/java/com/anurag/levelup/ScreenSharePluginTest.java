package com.anurag.levelup;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ScreenSharePluginTest {

    @Test
    public void currentGenerationAcceptsMatchingAttempt() {
        assertTrue(ScreenSharePlugin.isCurrentCaptureStart(7L, 7L));
    }

    @Test
    public void currentGenerationRejectsObsoleteAttempt() {
        assertFalse(ScreenSharePlugin.isCurrentCaptureStart(7L, 8L));
    }
}
