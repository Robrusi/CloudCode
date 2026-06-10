# Autumn Billing Setup

This directory contains the Autumn product catalog for Cloudcode.

## Catalog

- `free`: $0/month plan with included sandbox usage
- `hobby`: $10/month subscription
- `plus`: $20/month subscription
- `infra_usage`: metered, consumable usage tracked in micro-USD.

Usage is measured in micro-USD so fractional Trigger and Daytona costs can be
tracked precisely without floating point drift.

## Push

Run Autumn against this directory:

```sh
pnpm exec atmn push --config autumn
```

The root `autumn.config.ts` re-exports this setup for tools that still expect
Autumn's default config path.
