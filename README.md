# React Merge

A visual 2-way diff and 3-way merge tool in Electron, TypeScript and React. The merge view is a
self-contained React module, so it can also be embedded in another Electron app.

## Run

```bash
nvm use 22
npm install
npm run build
bin/react-merge left.txt right.txt                   # diff
bin/react-merge base.txt left.txt right.txt out.txt  # merge into out.txt
bin/react-merge                                      # file chooser
```

`npm run dev -- <args>` runs the app with hot reload.

## Command line

`bin/react-merge -h` lists all the options:

| Option                        | Meaning                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `-da` / `-dl` / `-db` / `-dw` | comparison: everything / ignore line endings (default) / also white space length / also all white space |
| `-tw <n>`                     | tab width                                                                                               |
| `-le unix\|win\|mac`          | line endings of the merge file                                                                          |
| `-C <charset>`                | file encoding (`none`, `utf8`, `utf8-bom`, `utf16*`, `utf32*`, `winansi`, `shiftjis`, ...)              |
| `-nb/-nl/-nr/-nm <label>`     | labels shown instead of the base, left, right and merge file names                                      |

It can be used as an external merge tool. For example, with git:

```bash
git config --global merge.tool react-merge
git config --global mergetool.react-merge.cmd '/path/to/react-merge/bin/react-merge "$BASE" "$LOCAL" "$REMOTE" "$MERGED"'
```

## Features

- **2-way diff**: side-by-side panes joined by connector bands, or a single interleaved pane.
  The Edit Left/Right Pane commands make a pane editable; the diff is recomputed as you type,
  and Save writes the file back with its own encoding and line endings.
- **3-way merge**: the left, base and right panes (base can be hidden) sit above an editable merge
  result. Each change has a group of buttons for picking the base, left and right text, in click
  order. A source with the same text as another shows as a dot. Conflicts start out showing all
  three texts with a red outline, and saving with unresolved conflicts asks first. A legend shows
  the changes per side, changes common to both, and the number of conflicts.
- **Display**: inline (token-level) differences, syntax highlighting (refractor), line numbers,
  visible tabs and spaces, synchronized scrolling, and highlighting of the current diff.
- **Commands**: previous/next diff and conflict (Ctrl+1–4), Find (with "only in differences"),
  Go to line, undo/redo, Refresh All, Save/Save As, and New Merge or Diff (opens a new window).
- **Files**: 30 encodings (iconv-lite), with byte-order-mark detection and a prompt to pick
  another encoding when a file isn't valid in the current one. Binary-file and large-file
  warnings. Line ending choice for the merge file.
- **Preferences** (persisted): font, tab width, insert spaces, default encoding and line
  ending, comparison method, display toggles, and color scheme (system, light or dark).
- A native menu bar (File, Edit, View, Search, Help) with keyboard shortcuts. The React view handles
  its shortcuts itself, so it keeps working when embedded without that menu.

## Layout

```
src/shared/merge/   pure engine, no DOM/Electron: text model, comparison methods,
                    Myers diff, 2-/3-way chunking, inline diffs, editable merge document
src/shared/         CLI parsing, charsets, IPC contract (HostApi, Preferences)
src/main/           Electron main: windows, native menu, file I/O + encodings, prefs
src/preload/        exposes HostApi as window.api
src/renderer/src/merge/   the React module (MergeApp + views, custom editor, dialogs)
```

To embed the merge view in another app, copy `src/shared/merge`,
`src/shared/{args,charsets,ipc}.ts` and `src/renderer/src/merge`, then render
`<MergeApp host={…} session={…} />` with any object that implements `HostApi`
(`src/shared/ipc.ts`). The UI uses CSS colour tokens (`--color-*`) plus its own `--m-*` merge
palette (`assets/main.css`). Dependencies: `@tanstack/react-virtual`, `refractor`, `iconv-lite`
(main only), `lucide-react`, React 19, Tailwind 4.

## Tests

```bash
npm test            # engine, CLI and encoding unit tests (vitest)
npm run test:e2e    # drives the built app with Playwright (needs `npm run build` first)
npm run lint && npm run typecheck
```

The e2e tests also save screenshots of both themes, the single-pane layout and the dialogs to
`test-results/screens/`.

## Diff and merge rules

- **Line diff**: Myers' algorithm (linear-space, middle snake) with fixed tie-breaking: common
  prefix then suffix stripping, diagonals visited in ascending order, split at the first overlap,
  and a cost cap for very different inputs. A final "forward bias" pass slides ambiguous gaps as
  far down as they go.
- **3-way chunks**: when one side's change ends where the other side's starts, they stay apart
  only if the first is a deletion or both are replacements; otherwise they form a conflict.
  Overlapping deletions are split line by line into one-side and "common to both" parts when
  staggered, starting on the same line, or ending together at the end of the file; otherwise they
  conflict.
- **Shared lines inside a conflict**: the two sides' texts are aligned against each other. Lines
  both have become changes common to both, a stretch only one side has becomes that side's
  change, and only stretches where both differ stay conflicts. The replaced base lines go with
  the piece whose text they match (a side still equal to the base didn't change it), otherwise
  one for one with the shared pieces. Pure insertions only split in simple shapes (at most one
  non-shared piece, or a conflict followed by a final one-sided piece).
- An undecided conflict starts with base, left and right text all included.
- With white space ignored, unchanged regions show the reference file's text in every read-only
  pane (base in a merge, left in a diff), and the merge takes the base text.
- The merge file's line endings default to the preference (system), not the input files' own.
- Every file on the command line must exist, the merge result included. Argument errors are
  reported but the exit status stays 0.

## Known limitations

- Text only: no image comparison.
- When the right file repeats a line near a change, a few 3-way cases are still grouped
  differently (about 1 in 30 random merges in testing).
