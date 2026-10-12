# Reader architecture review

Reviewed 12 October 2026. This is a targeted source review, not a claim that every reader or browser has been tested. Links to moving branches describe the code inspected on this date.

## What other readers teach us

| Project / source | Observed implementation | Implication for Folio |
| --- | --- | --- |
| [Readest architecture](https://github.com/readest/readest/blob/main/apps/readest-app/docs/architecture.md) | React application, separate state stores and reader hooks, a Foliate-JS fork, and platform service boundaries. | Keep the renderer's lifecycle separate from React panels, account state and cloud persistence. Opening settings should not recreate book frames. |
| [Readest selection hook](https://github.com/readest/readest/blob/main/apps/readest-app/src/app/reader/hooks/useTextSelector.ts) | Explicit states for pointer gestures, native text selection and programmatic selection changes; touch handling defers popup updates during dragging. Some behavior uses native app integrations. | A single mouseup handler is insufficient. Track actual live selection, clear stale actions, and distinguish browser capabilities from native app capabilities. |
| [Foliate-JS README](https://github.com/johnfactotum/foliate-js/blob/main/README.md) and [paginator](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js) | Parser and renderer are separate. The paginator works with DOM ranges and maintains an anchor across layout changes. Upstream explicitly does not support continuous scrolling across the whole book. | Preserve the visible text anchor when fonts, images or viewport geometry change. A Foliate migration needs a separate whole-book scrolling evaluation. |
| [Readium TypeScript toolkit](https://github.com/readium/ts-toolkit) and [Peripherals module](https://github.com/readium/ts-toolkit/blob/develop/navigator-html-injectables/src/modules/Peripherals.ts) | Shared publication models, navigator, and iframe-side modules are separate packages. Input events are interpreted inside the content context and communicated to the host. Selection is checked before treating a release as a navigation tap. | Define an explicit renderer-to-UI event boundary. A tap that dismisses selection must not also toggle controls or navigate. |
| [EPUB.js continuous manager](https://github.com/futurepress/epub.js/blob/master/src/managers/continuous/index.js) | Multiple chapter views, asynchronous loading, prepend compensation and scroll-driven visibility updates. The inspected master source includes guards against repeated iframe redraw and teardown during active scrolling. Folio uses installed version 0.3.93 plus its own adapter. | Compare actual installed code, not just upstream master. Chapter geometry and frame lifecycle are credible sources of jumps; changing CSS alone cannot resolve all of them. |

## Concrete Safari finding

Foliate's paginator explicitly cites [WebKit bug 218086](https://bugs.webkit.org/show_bug.cgi?id=218086): parent-installed event handlers can be blocked inside a same-origin sandboxed `srcdoc` iframe without `allow-scripts`. This matches our renderer configuration and the reported symptom of visible text selection without a highlight action. It is a strong hypothesis, not yet a confirmed diagnosis on the user's iPad.

Folio now also samples live selection from the parent window every 250 ms while the page is visible. It compares range boundaries before constructing a CFI or updating React. Empty neighbouring chapters cannot clear an active selection; collapsing the selection or unloading its chapter clears the action. The sample pauses while editing a highlight, and its timer is removed on reader cleanup. Uploaded-book scripts remain disabled. No third-party implementation code was copied.

## Recommended boundaries for Folio

1. **Book source:** obtain immutable bytes, parse metadata/spine and manage resources.
2. **Renderer adapter:** exclusively own frames, layout, chapter loading and navigation. Preserve content anchors through reflow; distinguish user scrolling from internal compensation.
3. **Input and selection controller:** translate gestures and live DOM ranges into selection/navigation events. Do not use separately parsed XML to read the selected passage.
4. **Reading session:** maintain the current content anchor and whether a location change should be saved. Programmatic startup or reflow must not overwrite newer reading progress accidentally.
5. **Persistence:** synchronize the durable anchor independently of device-specific typography. Page numbers are derived from the current layout and cannot be the sole cross-device resume key.
6. **UI:** toolbars and panels consume state without remounting the renderer or repeatedly changing its measured dimensions.

These are recommendations derived from the review, not a completed architecture rewrite. Keep the existing engine while collecting the Brave trace. If its lifecycle remains difficult to control, prototype another renderer behind the existing reader interface and compare the same EPUB on real devices before migration.

## Debugging the remaining Brave jump

After deploying this new build:

1. Open the library, then append `?readerDebug=1` to its URL and reload. Keep the query present when opening the book; if navigation drops it, append it to the book's URL and reload there.
2. Open the affected EPUB in iPad Brave and reproduce a jump.
3. Immediately press **Capture jump**, then **Save trace**. **Copy trace** is an alternative.
4. Share the JSON and describe the gesture and approximate chapter. Repeat in Safari with the same book if practical.

The opt-in recorder captures a bounded in-memory history of viewport dimensions, frame sizes, chapter indexes, scroll calls, relocations and hashed anchor comparisons. It includes the build identifier and browser user agent, but no book text, raw CFIs, book paths, credentials or free-form error messages. It makes no upload itself. A hash is only a comparison aid, not encryption or a unique identifier guarantee.

Interpretation: a `display` event suggests explicit navigation; `view-resize` above the visible paragraph followed by compensation suggests layout correction; viewport changes suggest browser chrome involvement. Correlation alone does not establish the cause. The trace should identify which path needs a targeted reproduction.

Acceptance on real iPad: sustained scrolling through short and long chapter boundaries; reversing direction; browser toolbar expansion/collapse; rotation; font changes; native selection-handle dragging; selection dismissal; and resume on another device. Desktop Chromium emulation cannot establish iPad Safari or Brave correctness.

## Local verification and remaining uncertainty

The browser fixture checks live selection-to-CFI round trips, selection dismissal, unchanged sandbox permissions, and scrolling with diagnostics attached. It exposed an EPUB.js element-boundary offset issue; the selection helper now normalizes those boundaries on a cloned range without moving native handles. The final tablet-sized and desktop Chromium regression run passed. An earlier run observed a late-content layout shift despite passing ordinary forward/reverse scrolling checks, so the existing scrolling path still needs timing-sensitive investigation and real-iPad traces. No change in this review is claimed to resolve the remaining Brave jump, and nothing was deployed.
