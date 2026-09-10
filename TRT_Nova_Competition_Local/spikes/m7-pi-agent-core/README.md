# M7 PI Agent Core compatibility spike

This directory is an isolated, non-production compatibility test. It does not
load NOVA secrets, connect to MySQL, call a paid provider, or execute business
writes.

It verifies:

- ESM package loading;
- a CommonJS-to-ESM bridge suitable for the current `agent-scf` entry style;
- multi-step tool execution and ordered lifecycle events;
- schema rejection before tool execution;
- policy blocking through `beforeToolCall`;
- a completed-turn budget;
- deadline-driven abort and final lifecycle settlement.

Install with lifecycle scripts disabled:

```powershell
npm install --ignore-scripts
```

Run on the minimum runtime supported by PI Core:

```powershell
npx --yes -p node@22.19.0 node --test spike.test.mjs
npx --yes -p node@22.19.0 node measure-import.mjs
```

Tencent Cloud SCF currently documents Node.js 20.19 as its newest standard
Node.js runtime. The same tests may be run on 20.19 to collect evidence, but a
passing result does not override PI Core's declared `node >=22.19.0` support
boundary.

```powershell
npx --yes -p node@20.19.0 node --test spike.test.mjs
npx --yes -p node@20.19.0 node measure-import.mjs
```
