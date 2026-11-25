# Reporting dates and timezones

`hermes.reportingPeriods` enables fresh server clock context on inference requests.
It defaults to false upstream and is enabled by the pilot generator.
`hermes.reportingTimeZone` is an IANA organization timezone (upstream default UTC;
pilot default America/Toronto). `prepare-integration.cjs --timezone <zone>` changes
the pilot setting. Caller-supplied body timezone/date overrides are not trusted.

The resolver supports today, yesterday, last/this week, month, quarter and year.
Weeks start Monday. Calendar boundaries are converted independently to UTC, so
days and months spanning DST retain the correct duration. End bounds are exclusive.
More than one recognized period requires clarification; comparison reporting is
not resolved automatically. Unsupported expressions and follow-up report edits
receive instructions to clarify/preserve the report's stated dates, but are not
deterministically resolved or persisted as a reporting contract in this release.

Each context includes an as-of instant and a bridge signature. The Hermes plugin
captures it from the provider-bound system prompt and scopes it to the native
session and turn. Unsigned, expired and non-LibreChat contexts do not install a
policy. No credentials, customer query contents or sales results enter audit logs.

The pre-tool guard validates Odoo data reads (including lazy `tool_call` batches)
for sale.order, sale.order.line, sale.report, account.move and account.move.line.
It requires exact same-field `>= start` and `< end` bounds; ambiguous OR/NOT domains
are blocked. Invoice dates use local dates; Odoo timestamp fields use UTC. Schema
discovery remains available. A rejected query returns a correction to the agent,
without executing the tool or automatically widening/substituting the period.

This is a reporting correctness guard, not a sandbox security boundary. Arbitrary
shell/SQL, unrecognized models/connectors, historical cached data and model-written
output are not mechanically validated. Instructions prohibit shell reporting
queries, fallback periods and fabricated future/empty results. New connector
adapters and output/data provenance checks are needed for stronger guarantees.

Deployment enables the policy plugin and restarts Hermes. The organization
provisioner does the same for newly provisioned stacks. Existing separate customer
stacks must receive the release individually. Disabling/removing the Hermes plugin
disables tool enforcement; it must remain enabled on managed profiles.

Regression tests use synthetic domains and frozen clocks; they do not rerun or
modify any existing customer report or artifact.
