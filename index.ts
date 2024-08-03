export default await (async () => {
  console.log("getting chunk ids");
  const rootUrl = "https://cohost.org";
  const html = await fetch(rootUrl + "/rc/welcome").then((res) => res.text());
  const runtimeUrlRE = /\/static\/runtime\.\S{20}\.js/gm;
  const runtimeUrl = html.match(runtimeUrlRE)![0];
  const clientUrlRe = /\/static\/client\.\S{20}\.js/gm;
  const clientUrl = html.match(clientUrlRe)![0];
  // get the webpack chunk info from runtime.*.js
  const runtime = await fetch(rootUrl + runtimeUrl).then((res) => res.text());
  const webpackChunkInfoRE =
    /function\(\w+\){return\((.*?}).*({.*}).*\+"\.js"}/gm;
  const webpackChunkInfoRaw = webpackChunkInfoRE.exec(runtime);
  const prefixes = new Function(`return ${webpackChunkInfoRaw![1]}`)();
  const suffixes = new Function(`return ${webpackChunkInfoRaw![2]}`)();
  // combine the prefixes and suffixes to get the webpack chunk urls
  const ids = Object.keys(suffixes);
  const webpackChunkUrls = ids.map((id) => {
    const prefix = prefixes[id] || id;
    const suffix = suffixes[id];
    return `${rootUrl}/static/${prefix}.${suffix}.js`;
  });
  webpackChunkUrls.push(clientUrl);
  let accessibleModules: Record<string, string> = {};
  const cacheKey = "easrng-accessibleModules-" + runtimeUrl.split("/").at(-1)!;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    console.log("using cached accessibleModules");
    accessibleModules = JSON.parse(cached);
  } else {
    // clear old cache
    for (const key of Array.from({ length: localStorage.length }, (e, i) =>
      localStorage.key(i),
    )) {
      if (key?.startsWith("easrng-accessibleModules-")) {
        localStorage.removeItem(key);
      }
    }
    const sourceMapPromise = (async () => {
      console.log("loading library source-map");
      await import(
        "https://unpkg.com/source-map@0.7.3/dist/source-map.js" as string
      );
      const sourceMap = (globalThis as any)
        .sourceMap as typeof import("source-map");
      (sourceMap.SourceMapConsumer as any).initialize({
        "lib/mappings.wasm":
          "https://unpkg.com/source-map@0.7.3/lib/mappings.wasm",
      });
      return sourceMap;
    })();
    const loadedChunksPromise = (async () => {
      console.log("loading all chunks and sourcemaps");
      let i = 0;
      const total = webpackChunkUrls.length;
      return await Promise.all(
        webpackChunkUrls.map(async (e) => {
          const [map, text] = await Promise.all([
            fetch(e + ".map").then((e) => e.json()),
            fetch(e).then((r) => r.text()),
          ]);
          i++;
          console.log(`${((i / total) * 100).toFixed()}%`);
          return {
            lines: text.split("\n"),
            map,
            file: e.split("/").at(-1)!,
          };
        }),
      );
    })();
    const [files, sourceMap] = await Promise.all([
      loadedChunksPromise,
      sourceMapPromise,
    ]);

    console.log("finding accessible module ids");
    const total = files.reduce((a, b) => a + b.map.sources.length, 0);
    let i = 0;
    for (const { map, lines } of files)
      await sourceMap.SourceMapConsumer.with(map, null, async (map) => {
        for (const source of map.sources) {
          const position = map.generatedPositionFor({
            source,
            line: 1,
            column: 0,
          });
          i++;
          if (position.line != null && position.column != null) {
            const context = lines[position.line - 1].slice(
              Math.max(position.column - 40, 0),
              position.column,
            );
            const id = context.match(
              /([^{,]+):function\([^\)]+\){(?:.\.exports=|\(|"use strict";?)?$/,
            )?.[1];
            if (id != null) {
              accessibleModules[source.replace("webpack://", "")] = id;
            } else {
              // module was probably concatenated. to check if we're missing something, uncomment
              // console.log(context);
            }
            console.log(`${((i / total) * 100).toFixed()}%`);
            await new Promise((cb) => setTimeout(cb, 0));
          }
        }
      });
    localStorage.setItem(cacheKey, JSON.stringify(accessibleModules));
  }
  let webpackRequire: (id: string | number) => any;
  ((globalThis as any).__LOADABLE_LOADED_CHUNKS__ as any[]).push([
    [9384093284093840],
    { 9384093284093840() {} },
    (r: any) => (webpackRequire = r),
  ]);
  return Object.assign(
    (file: string) => webpackRequire(accessibleModules[file]),
    { modules: Object.keys(accessibleModules) },
  );
})();
