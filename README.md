# Airport Data

Airport data for the VATSIM France tools, maintained by the vACC and edited through pull requests.

| Folder | Content | How it is edited |
|---|---|---|
| [`runways/`](runways/) | Runway geometry of the French airports: ends, true headings, thresholds, lengths | Generated at each AIRAC |
| [`runway-use/`](runway-use/) | How runways are used: preferred configurations, conditions, restrictions, closures and linked airports, one file per FIR | By hand |
| [`schemas/`](schemas/) | JSON Schemas of the datasets | Generated |
| [`tools/`](tools/) | `airport-data.mjs`: checks the datasets and generates their schemas | Generated |

Today aras, the vACC runway assignment service, reads this data to decide which runways are in use. Other datasets, such as ATC positions, will be added next to these.

## Checking a change

Only Node 24 is needed; there is nothing to install.

```sh
node tools/airport-data.mjs validate      # or: npm run validate
```

It prints a summary when everything is valid, or every problem with its file and key:

```
runway-use/LFBB.toml: LFBD.choice.3.runways: runway 12/30 does not exist at LFBD
1 problem found
```

Every pull request runs the same check. Problems appear as annotations on the changed files.

## Runway database

`runways/LF.json` lists each airport with its position, name and runways. Each runway has its two ends, with the true heading (computed from the threshold coordinates) and the threshold position, plus its length. The file records the AIRAC cycle it was generated from. Its schema is `schemas/runways.schema.json`.

The file is generated. Do not edit it by hand: see [CONTRIBUTING.md](CONTRIBUTING.md#airac-update) for the AIRAC update.

## Runway use

Runway use is written in TOML, in `runway-use/<FIR>.toml`. Each file starts with this line, which gives validation and help in editors that support it (for example VS Code with the *Even Better TOML* extension):

```toml
#:schema ../schemas/runway-use.schema.json
```

An airport is defined in one file only. An airport without an entry has no runway-use rules; a tool reading this data then applies its own default. aras, for example, uses the longest runway facing into the wind.

### Choices

Each airport lists **numbered choices**. Choice 1 is the first choice, and the first **usable** choice is the one in use. A choice is usable when:

- its `when` condition holds,
- none of its runways is unavailable,
- every runway is within the wind limits.

```toml
[defaults]                 # applies to every airport of this file
timezone = "Europe/Paris"
max_tailwind = 5           # kt, gusts included
max_crosswind = 20         # kt, gusts included

[LFBD.choice.1]
note = "Main runway, into wind"
runways = ["05/23"]
max_crosswind = 15

[LFBD.choice.2]
note = "Crosswind runway"
runways = ["11/29"]
```

Here LFBD uses 05/23 facing into the wind until the crosswind goes above 15 kt, then 11/29.

- `runways = ["05/23"]` means that runway, **facing into the wind**. `runways = ["23"]` means that direction only.
- Several runways on one line are used together: `runways = ["07L/25R", "07R/25L"]`.
- For different arrival and departure runways, use `arr` and `dep` instead of `runways`:

  ```toml
  [LFPG.choice.1]
  name = "WEST"
  arr = ["26L", "27R"]
  dep = ["26R", "27L"]
  ```

- Gaps in numbering are fine (10, 20, 30…), which leaves room to insert a choice later.
- `max_tailwind` and `max_crosswind` can be set in `[defaults]`, on an airport or on a choice. The most specific value wins.

### Conditions

`when` takes a condition written as a short sentence:

```toml
[LFBD.choice.1]
note = "Night noise procedure"
arr = ["23"]
dep = ["05"]
when = "time 22:00-06:00 and wind < 5"
```

| Write | Meaning |
|---|---|
| `crosswind 05/23 >= 15`, `tailwind 23 > 5`, `headwind 27 < 3` | Wind component on a runway, in kt. Crosswind also accepts a runway pair |
| `wind < 5` | Wind speed in kt, gusts included |
| `visibility < 1500`, `rvr < 550`, `ceiling < 300` | Metres, metres, feet |
| `lvo` | Low-visibility operations (see below) |
| `time 22:00-06:00` | Local time of the airport, may cross midnight |
| `and`, `or`, `not`, `( )` | Combine conditions |

Comparisons are `<`, `<=`, `>` and `>=`. A value that is not reported (no RVR, no METAR…) makes its comparison false. The absence of a ceiling counts as an infinitely high ceiling. `lvo` can be defined in `[defaults]` or on an airport and defaults to `rvr < 550 or visibility < 550 or ceiling < 200`.

### Unavailable runways

```toml
[[LFBD.unavailable]]
runways = ["11/29"]
when = "lvo"
note = "No LVP on 11/29"

[[LFBD.unavailable]]
runways = ["11/29"]
from = 2026-10-01T00:00:00Z
to = 2026-10-12T23:59:00Z
note = "NOTAM A1234/26"
```

A runway is unavailable while all the given `when`, `from` and `to` hold (`from` included, `to` excluded). With none of them, it is closed permanently.

### Linked airports and weather stations

```toml
[LFPN]
follow = "LFPO"               # always face the same way as LFPO
metar = ["LFPN", "LFPV"]      # first fresh METAR is used
```

`follow` takes priority over the wind: only a closed runway can prevent it. Without `metar`, an airport uses its own METAR, else the nearest one within 30 NM.

### Stability settings

These can go in `[defaults]` or on an airport:

| Setting | Default | |
|---|---|---|
| `hysteresis_margin` | `3` | Knots below the limits needed to go back to a better choice |
| `lookahead_hours` | `2` | Hours of forecast a better choice must stay usable for before switching to it |
| `established_tailwind_hours` | `3` | Hours a forecast tailwind must last before a choice gives way to one without tailwind. Also allowed on a choice; `0` disables it |

The configuration in use stays while it is usable. Going back to a better choice needs the wind to be under the limits minus the margin, and the forecast to agree. A tailwind within `max_tailwind` is only tolerated while it is temporary or variable. When the forecast keeps a tailwind from a defined direction on a runway for `established_tailwind_hours`, and another choice is usable without one, that other choice is used. Set `established_tailwind_hours = 0` on a choice that deliberately accepts a tailwind, such as a night noise procedure.

## Generated files

Do not edit these by hand:

- `runways/*.json`: see [the AIRAC update](CONTRIBUTING.md#airac-update).
- `schemas/*.json` and `tools/airport-data.mjs`: exported together from aras, where the data format and its checks are developed. The first line of the tool names the aras version and commit it comes from.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Commits follow [Conventional Commits](https://www.conventionalcommits.org).
