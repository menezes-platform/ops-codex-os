# Agent learning — PowerShell nested quoting on Remote Desktop Commander

Date: 2026-09-24
Context: inventorying Hermes + OmniRoute on TTK VM (EC2AMAZ-7IT0M73) before cloning the infrastructure.

## Failure
A single large `powershell -Command` invocation mixed nested single/double quotes and a regex replacement intended to redact secrets. PowerShell returned `TerminatorExpectedAtEndOfString`.

## Root cause
The remote command passed through multiple quoting layers (JavaScript -> MCP argument -> PowerShell), making the inline regex/string escaping brittle.

## Correction
Prefer small, composable PowerShell inventory commands. Avoid embedding secret-redaction regexes inside deeply nested command strings; query only non-secret fields where possible. If a complex script is required, write a temporary `.ps1` file or use an encoded command.

## Reuse rule
For future Windows remote inventory:
1. collect process/service/task metadata in separate calls;
2. retrieve environment-variable **names only**, never values;
3. inspect config paths explicitly rather than dumping raw command lines;
4. use a temporary script for multi-step logic.

## Follow-up failure
A second attempt still invoked an inner `powershell -Command` while already running under Desktop Commander's PowerShell shell. The outer shell expanded `$_` before the inner shell saw it, producing errors such as `.Name is not recognized` and `.TaskName is not recognized`.

## Final correction
Do not nest PowerShell for ordinary inventory calls in Remote Desktop Commander. Send the cmdlet pipeline directly to the existing PowerShell shell. This preserved `$_` correctly and the inventory succeeded.
