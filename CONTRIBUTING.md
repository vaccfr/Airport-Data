# Contributing

Changes go through pull requests, reviewed by the maintainers of the FIR concerned. Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), for example `feat(runway-use): add LFMN` or `fix(runway-use): LFBD crosswind limit`.

## Changing runway use

1. Create a branch and edit the file of the FIR in `runway-use/` (see the [README](README.md#runway-use) for the format).
2. Check it locally with Node 24:

   ```sh
   node tools/airport-data.mjs validate
   ```

3. Open a pull request. Say what changes and why, for example the procedure or letter of agreement it follows.
4. The **Validate** check must pass. Any problem is shown as an annotation on the file concerned, and on its line for TOML syntax errors.

A new airport is added to the file of its FIR. When no file exists yet for that FIR, create `runway-use/<FIR>.toml` with the schema line at the top.

## Changing control positions

1. Create a branch and edit the file of the FIR in `positions/` (see the [README](README.md#control-positions) for the format).
2. Check it with the same command:

   ```sh
   node tools/airport-data.mjs validate
   ```

3. Open a pull request. Say which positions change and what they now cover, for example the letter of agreement the top-down service follows.

Only approach and centre need an entry. Tower, ground, delivery and ramp are responsible for the airport their callsign names, so adding them changes nothing.

Every airport named has to exist in `runways/`, since a position lists an airport precisely so that its runways can be set. A callsign can only be claimed by one entry, and validation names the other file when two claim it.

## AIRAC update

The runway database is regenerated at each AIRAC:

1. Replace `runways/LF.json` with the database of the new cycle.
2. Open a pull request titled `feat(runways): AIRAC <cycle>`.
3. If a runway used in `runway-use/` disappeared or was renamed, validation fails and names the file and key to fix. Fix them in the same pull request.

## Updating the tool and schemas

`tools/airport-data.mjs` and `schemas/` are exported from aras, where the data format and its checks are developed. They are never edited here. After a change to the format in aras, a maintainer with access to it runs:

```sh
pnpm export:tools --out ../airport-data
```

and opens a pull request here titled `build: update the data tool to aras <version>`. The **Validate** check fails if `schemas/` does not match the tool.

## Adding a dataset

A new kind of data (for example ATC positions) gets its own top-level folder named after the data, not after a tool, with its schema in `schemas/` and its checks in the data tool.
