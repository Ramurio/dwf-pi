# Watch a running workflow

```sh
node --import tsx src/watch.ts --run run-…
node --import tsx src/watch.ts --run run-… --store /path/to/state.sqlite
node --import tsx src/watch.ts --run run-… --once
```

The default journal is `$DYNAMICWF_HOME/state.sqlite`, or `~/.dynamicwf/state.sqlite` when that environment variable is unset, matching the CLI service. `--once` prints a complete diagram and exits. Each graph lists its nodes and arrows, including conditional and loop edges; map and subworkflow references link to the corresponding graph definition. Conditional edges are marked `[if]`; conditions are evaluated by the workflow runtime, not the viewer.

On a terminal, watch redraws the diagram when execution state changes. With stdout redirected to a file or pipe, it emits one concise line per observed state change. Polling is every 500 ms, so brief intermediate states may be missed; the journal remains the complete event history. Terminal runs automatically end watching. Paused and interrupted runs remain visible until Ctrl-C.

Ctrl-C and SIGTERM detach the viewer. They do not pause or cancel the workflow or terminate its supervisor. The viewer only reads run and activation records: it does not claim execution ownership or infer process death from polling. A journal status may therefore remain `running` after an unobserved crash until the control service reconciles it.

Node state aggregates recorded activations across scopes and visits. Active rows show graph, node, invocation scope, visit and attempt, allowing parallel/map workers to be distinguished. The counters are recorded successful/running/failed/interrupted activations; they are not a prediction of the number of future loop iterations or fan-out items. No completion percentage is invented. Structural parents can remain `running` while a paused workflow waits at a checkpoint; the diagram labels these paused structural activations explicitly.

The symbols are `○` not visited, `▶` running, `✓` succeeded, `×` failed and `!` interrupted. On a node with multiple records, the label prioritizes running, then interrupted, then failed. Each graph is shown even if no activation has visited it yet. Long user text is visibly shortened; ANSI escapes, control characters and direction-changing Unicode characters from workflow fields, scopes or errors are displayed as escaped text rather than executed by the terminal.
