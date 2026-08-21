package com.virtualcompanion.runtime.observability;

/** Alert severity tiers (§22.12 告警分级草案 — see
 * docs/beta-readiness/07-告警分级与Webhook通道.md for the Owner-reviewable
 * draft). P0 pages immediately; P1 same-shift response; P2 next review. */
public enum AlertSeverity {
    P0,
    P1,
    P2
}
