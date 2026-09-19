# Cluster job examples

AGI scripts that use an ArozOS cluster as one computer. Each example is a
pair of files:

- **`<name>.agi`** is the launcher. You run it like any AGI script, for
  example with the Serverless tool, from Code Studio, or with
  `/system/ajgi/interface?script=<path>`. It submits the job, waits for it
  and returns the result as JSON.
- **`<name>.job.agi`** is the job. The cluster copies its source at submit
  time and runs it on the node the scheduler picks. It defines
  `run(job)`, and whatever `run` returns becomes the job output.

Keep both files of a pair in the same folder: the launcher refers to its job
by a relative path. The node you run the launcher on must be a member of a
cluster (System Settings > Cluster).

| Example | What it shows |
|---|---|
| [`hello_world/`](hello_world/) | Sends one job to every usable node with the `nodes` option; each node answers "Hello World" with its own name, platform, capabilities and health |
| [`list_files/`](list_files/) | One job walks `cluster:/` with `filelib` and returns every file with its size and extension, plus totals per extension |
| [`ffmpeg_convert/`](ffmpeg_convert/) | Converts `cluster:/demo.mp4` to `cluster:/demo.webm`; the job asks for the `ffmpeg` capability and names its input, so it runs on a node with ffmpeg, preferably one that already holds the video |

## The job contract

```javascript
function setup(ctx) {        // optional, runs once before run(); ctx = {node}
}

function run(job) {          // job = {id, name, kind, args, inputs, node, owner}
    job.log("text");         // appears in the job log
    job.progress(0.5);       // 0..1
    job.abortIfCancelled();  // throws when someone cancelled the job
    return { ok: true };     // becomes the job output
}
```

Normal AGI libraries work inside a job. Use absolute paths there
(`cluster:/...`, `user:/...`): a job has no script folder of its own, so
relative paths are not resolved.

## Submitting from a launcher

```javascript
requirelib("cluster");

var id = cluster.jobs.submit({
    name: "My job",
    script: "my.job.agi",       // relative to the launcher, or a full vpath
    args: { any: "json" },      // shows up as job.args
    inputs: ["cluster:/a.mp4"], // files the job reads; nodes holding them are preferred
    features: ["ffmpeg"],       // required capabilities
    nodes: ["<node id>"],       // optional: only these nodes may run it
    timeout: 600                // seconds
});

var rec = cluster.jobs.wait(id, 60);   // throws if it is still running after 60 s
// rec.state.status is "succeeded", "failed" or "cancelled"; rec.state.output holds run()'s return value
```

`cluster.jobs.status(id)`, `cluster.jobs.list()` and `cluster.jobs.cancel(id)`
work on jobs you submitted. Every job also appears on System Settings >
Cluster Jobs, and an administrator can see why a job landed where it did on
the Scheduling card of the Cluster page.

A job that no node can take yet stays queued, and `rec.state.reason` says
why, for example that no online node has ffmpeg.
